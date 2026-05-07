import type { WorkThread } from "@arb/work-queue";

export interface WorkThreadRepository {
  save(thread: WorkThread): Promise<void>;
  findById(id: string): Promise<WorkThread | null>;
  findByAffinityKey(userId: string, affinityKey: string): Promise<WorkThread | null>;
}
