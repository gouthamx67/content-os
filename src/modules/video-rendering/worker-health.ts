export type RenderWorkerHealthSnapshot = {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  currentJobId: string | null;
  lastError: string | null;
};

/**
 * In-process health for the render worker.
 *
 * The worker runs as a separate process, so its liveness cannot be inferred
 * from the web app's own event loop. This snapshot is what the health route
 * reports, and it is deliberately about whether work is moving rather than
 * whether the process merely exists.
 */
export class RenderWorkerHealth {
  private running = false;
  private startedAt: string | null = null;
  private lastTickAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private processed = 0;
  private succeeded = 0;
  private failed = 0;
  private cancelled = 0;
  private currentJobId: string | null = null;
  private lastError: string | null = null;

  markStarted(): void {
    this.running = true;
    this.startedAt = new Date().toISOString();
  }

  markStopped(): void {
    this.running = false;
    this.currentJobId = null;
  }

  markTick(): void {
    this.lastTickAt = new Date().toISOString();
  }

  markJobStarted(renderJobId: string): void {
    this.currentJobId = renderJobId;
    this.processed += 1;
  }

  markJobFinished(outcome: "SUCCEEDED" | "FAILED" | "CANCELLED"): void {
    this.currentJobId = null;
    const now = new Date().toISOString();

    if (outcome === "SUCCEEDED") {
      this.succeeded += 1;
      this.lastSuccessAt = now;
    } else if (outcome === "CANCELLED") {
      this.cancelled += 1;
    } else {
      this.failed += 1;
      this.lastFailureAt = now;
    }
  }

  markError(message: string): void {
    this.lastError = message.slice(0, 300);
  }

  snapshot(): RenderWorkerHealthSnapshot {
    return {
      running: this.running,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      cancelled: this.cancelled,
      currentJobId: this.currentJobId,
      lastError: this.lastError,
    };
  }
}
