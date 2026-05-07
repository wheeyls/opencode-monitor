import type { Clock } from "../clock.js";
import type { WorkThread } from "../entities/work-thread.js";
import type { Client } from "../entities/client.js";

export interface AffinityConfig {
  /** How long a client preference lasts after last completion. Default: 24h. */
  preferenceTtlMs: number;
}

const DEFAULT_CONFIG: AffinityConfig = {
  preferenceTtlMs: 86_400_000, // 24 hours
};

export class AffinityPolicy {
  private config: AffinityConfig;

  constructor(config?: AffinityConfig) {
    this.config = config ?? DEFAULT_CONFIG;
  }

  get preferenceTtlMs(): number {
    return this.config.preferenceTtlMs;
  }

  /**
   * Record that a client completed work on a thread.
   * Sets the thread's preference to this client.
   */
  recordCompletion(
    thread: WorkThread,
    clientId: string,
    sessionRef: string | null,
    clock: Clock,
  ): void {
    thread.setPreference(clientId, sessionRef, this.config.preferenceTtlMs, clock);
  }

  /**
   * Score a candidate client for a thread.
   * Returns a value where higher = better match.
   * - 2: preferred client, preference still valid
   * - 1: preference expired or no preference set
   * - 0: different client than preferred, preference still valid
   */
  score(thread: WorkThread, candidateClientId: string, clock: Clock): number {
    if (thread.preferredClientId === null || thread.isPreferenceExpired(clock)) {
      return 1; // No active preference — neutral
    }
    return thread.prefersClient(candidateClientId, clock) ? 2 : 0;
  }

  /**
   * Pick the best client from candidates for a thread.
   * Returns the client with highest affinity score, or null if none available.
   */
  pickBest(
    thread: WorkThread,
    candidates: Client[],
    clock: Clock,
  ): Client | null {
    if (candidates.length === 0) return null;

    let best = candidates[0];
    let bestScore = this.score(thread, best.id, clock);

    for (let i = 1; i < candidates.length; i++) {
      const s = this.score(thread, candidates[i].id, clock);
      if (s > bestScore) {
        best = candidates[i];
        bestScore = s;
      }
    }

    return best;
  }
}
