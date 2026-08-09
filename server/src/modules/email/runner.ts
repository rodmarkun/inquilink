import { safeOperationalErrorCode } from "./worker.js";

export interface WorkerLoopOptions {
  once: boolean;
  intervalMs: number;
  shouldStop: () => boolean;
  runIteration: () => Promise<void>;
  reportFailure: (code: string) => void;
  wait?: (milliseconds: number) => Promise<unknown>;
}

export async function runWorkerPhases(
  phases: Array<() => Promise<void>>,
  reportFailure: (code: string) => void,
): Promise<boolean> {
  let succeeded = true;
  for (const phase of phases) {
    try {
      await phase();
    } catch (error) {
      succeeded = false;
      reportFailure(safeOperationalErrorCode(error));
    }
  }
  return succeeded;
}

/** Runs one iteration for cron or keeps retrying for a long-lived worker. */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<0 | 1> {
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  while (!options.shouldStop()) {
    try {
      await options.runIteration();
    } catch (error) {
      options.reportFailure(safeOperationalErrorCode(error));
      if (options.once) return 1;
    }
    if (options.once || options.shouldStop()) return 0;
    await wait(options.intervalMs);
  }
  return 0;
}
