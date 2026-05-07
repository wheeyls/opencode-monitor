/**
 * Unit of work — wraps a set of repository operations in a transaction.
 * In Postgres this maps to a BEGIN/COMMIT/ROLLBACK.
 * In-memory fakes can just execute the callback directly.
 */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
