import { randomUUID } from "node:crypto";
import type { IdGenerator } from "@arb/work-queue-app";

export class PgIdGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
