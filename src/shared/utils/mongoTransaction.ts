import mongoose from "mongoose";

let supportsTransactionsCache: boolean | null = null;

/** True when MongoDB is a replica set (required for multi-document transactions). */
export async function mongoSupportsTransactions(): Promise<boolean> {
  if (supportsTransactionsCache !== null) {
    return supportsTransactionsCache;
  }

  try {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      supportsTransactionsCache = false;
      return false;
    }

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    supportsTransactionsCache = Boolean(hello.setName);
    if (!supportsTransactionsCache) {
      console.warn(
        "[mongo] Standalone MongoDB detected — using non-transactional writes. " +
          "For production, use a replica set (see docker-compose.yml / README)."
      );
    }
    return supportsTransactionsCache;
  } catch {
    supportsTransactionsCache = false;
    return false;
  }
}

export function dbSession(session?: mongoose.ClientSession | null) {
  return session ? { session } : {};
}

export async function runInTransaction<T>(
  fn: (session: mongoose.ClientSession | null) => Promise<T>
): Promise<T> {
  const useTx = await mongoSupportsTransactions();

  if (!useTx) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw err;
  } finally {
    session.endSession();
  }
}
