import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { OutboxEmailProvider } from "../modules/email/provider.js";
import { enqueueScheduledNotifications } from "../modules/email/scheduler.js";
import { createEmailTransport, dispatchEmailBatch, safeOperationalErrorCode } from "../modules/email/worker.js";
import { runWorkerLoop, runWorkerPhases } from "../modules/email/runner.js";
import { runDataLifecycle } from "../modules/rentals/lifecycle.js";
import { createPrivateDocumentStorage } from "../modules/rentals/providers.js";
import { cleanupAuthRateLimits } from "../auth/rate-limit.js";
import { cleanupAuthArtifacts } from "../auth/cleanup.js";
import { createBillingProvider } from "../modules/billing/provider.js";
import { reconcileAgencyClosures } from "../modules/billing/closure.js";
import { syncBillingProviderState } from "../modules/billing/sync.js";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main(): Promise<0 | 1> {
  const config = loadConfig();
  const transport = createEmailTransport(config);
  const billingProvider = createBillingProvider(config);
  const documentStorage = createPrivateDocumentStorage(config);
  const database = createDatabase(config.DATABASE_URL);
  try {
    return await runWorkerLoop({
      once: config.EMAIL_WORKER_ONCE,
      intervalMs: config.EMAIL_WORKER_INTERVAL_MS,
      shouldStop: () => stopping,
      reportFailure: (code) => process.stderr.write(`${JSON.stringify({ workerError: { code } })}\n`),
      runIteration: async () => {
        const clock = new Date();
        let agencyClosures: Awaited<ReturnType<typeof reconcileAgencyClosures>> | null = null;
        let billingSync: Awaited<ReturnType<typeof syncBillingProviderState>> | null = null;
        let scheduled: Awaited<ReturnType<typeof enqueueScheduledNotifications>> | null = null;
        let lifecycle: Awaited<ReturnType<typeof runDataLifecycle>> | null = null;
        let expiredRateLimitsDeleted: number | null = null;
        let authArtifacts: Awaited<ReturnType<typeof cleanupAuthArtifacts>> | null = null;
        let email: Awaited<ReturnType<typeof dispatchEmailBatch>> | null = null;
        const reportFailure = (code: string) => process.stderr.write(`${JSON.stringify({ workerError: { code } })}\n`);
        const succeeded = await runWorkerPhases([
          async () => { agencyClosures = await reconcileAgencyClosures(database.db, billingProvider, { now: clock }); },
          async () => { billingSync = await syncBillingProviderState(database.db, billingProvider, { now: clock }); },
          async () => { scheduled = await enqueueScheduledNotifications(database.db, new OutboxEmailProvider(database.db), clock); },
          async () => {
            lifecycle = await runDataLifecycle(database.db, documentStorage, {
              now: clock,
              ...(config.APPLICATION_RETENTION_DAYS !== undefined ? { retentionDays: config.APPLICATION_RETENTION_DAYS } : {}),
              ...(config.ACCOUNT_CLOSURE_RETENTION_DAYS !== undefined ? { accountRetentionDays: config.ACCOUNT_CLOSURE_RETENTION_DAYS } : {}),
            });
          },
          async () => { expiredRateLimitsDeleted = await cleanupAuthRateLimits(database.db, clock); },
          async () => { authArtifacts = await cleanupAuthArtifacts(database.db, clock); },
          async () => { email = await dispatchEmailBatch(database.db, transport, config.APP_ORIGIN, { now: () => clock }); },
        ], reportFailure);
        if (!succeeded) throw Object.assign(new Error("WORKER_ITERATION_FAILED"), { code: "WORKER_ITERATION_FAILED" });
        await writeFile(config.EMAIL_WORKER_HEALTH_FILE, clock.toISOString(), { mode: 0o600 });
        // Only aggregate operational counters are emitted; recipients and contents never reach logs.
        process.stdout.write(`${JSON.stringify({ email, agencyClosures, billingSync, scheduled, lifecycle, expiredRateLimitsDeleted, authArtifacts })}\n`);
      },
    });
  } finally {
    await database.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ workerError: { code: safeOperationalErrorCode(error) } })}\n`);
  process.exitCode = 1;
}
