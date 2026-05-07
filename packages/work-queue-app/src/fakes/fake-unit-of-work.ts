import type { UnitOfWork } from "../ports/unit-of-work.js";

export class FakeUnitOfWork implements UnitOfWork {
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
