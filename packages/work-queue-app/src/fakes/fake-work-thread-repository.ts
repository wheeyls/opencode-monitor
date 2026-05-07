import type { WorkThread } from "@arb/work-queue";
import type { WorkThreadRepository } from "../ports/work-thread-repository.js";

export class FakeWorkThreadRepository implements WorkThreadRepository {
  private threads: Map<string, WorkThread> = new Map();

  async save(thread: WorkThread): Promise<void> {
    this.threads.set(thread.id, thread);
  }

  async findById(id: string): Promise<WorkThread | null> {
    return this.threads.get(id) ?? null;
  }

  async findByAffinityKey(userId: string, affinityKey: string): Promise<WorkThread | null> {
    for (const thread of this.threads.values()) {
      if (thread.userId === userId && thread.affinityKey === affinityKey) {
        return thread;
      }
    }
    return null;
  }

  /** Test helper: get all threads. */
  all(): WorkThread[] {
    return [...this.threads.values()];
  }
}
