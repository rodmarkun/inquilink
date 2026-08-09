import { expect, it } from "vitest";
import { runWorkerLoop, runWorkerPhases } from "./runner.js";

it("returns a nonzero one-shot result and reports no sensitive top-level error details", async () => {
  const codes: string[] = [];
  const exitCode = await runWorkerLoop({
    once: true,
    intervalMs: 1,
    shouldStop: () => false,
    runIteration: async () => { throw Object.assign(new Error("SQL persona@example.es token-secreto"), { code: "token persona@example.es" }); },
    reportFailure: (code) => codes.push(code),
    wait: async () => undefined,
  });
  expect(exitCode).toBe(1);
  expect(codes).toEqual(["EMAIL_DELIVERY_FAILED"]);
  expect(JSON.stringify(codes)).not.toMatch(/persona|token-secreto/i);
});

it("keeps a long-running worker alive after a failed subsystem iteration", async () => {
  const codes: string[] = [];
  let iterations = 0;
  let stopping = false;
  const exitCode = await runWorkerLoop({
    once: false,
    intervalMs: 1,
    shouldStop: () => stopping,
    runIteration: async () => {
      iterations += 1;
      if (iterations === 1) throw Object.assign(new Error("private provider detail"), { code: "ETIMEDOUT" });
      stopping = true;
    },
    reportFailure: (code) => codes.push(code),
    wait: async () => undefined,
  });
  expect(exitCode).toBe(0);
  expect(iterations).toBe(2);
  expect(codes).toEqual(["ETIMEDOUT"]);
});

it("isolates worker phases so one failure cannot starve later cleanup and delivery", async () => {
  const calls: string[] = [];
  const codes: string[] = [];
  const succeeded = await runWorkerPhases([
    async () => { calls.push("scheduler"); throw Object.assign(new Error("private SQL"), { code: "SCHEDULER_FAILED" }); },
    async () => { calls.push("closure"); },
    async () => { calls.push("lifecycle"); },
    async () => { calls.push("delivery"); },
  ], (code) => codes.push(code));
  expect(succeeded).toBe(false);
  expect(calls).toEqual(["scheduler", "closure", "lifecycle", "delivery"]);
  expect(codes).toEqual(["SCHEDULER_FAILED"]);
});
