import { PGlite } from "@electric-sql/pglite";
import { pool } from "../server/db";
// Test-only adapter: real PostgreSQL engine compiled to WASM, never a production fallback.
export async function testDatabase(path?: string) {
  const db = new PGlite(path);
  await db.waitReady;
  let tail = Promise.resolve();
  async function lock() {
    let release!: () => void;
    const prior = tail;
    tail = new Promise<void>((r) => (release = r));
    await prior;
    return release;
  }
  const query = async (sql: string, params?: any[]) => {
    const r: any = await db.query(sql, params);
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  const originalQuery = pool.query.bind(pool),
    originalConnect = pool.connect.bind(pool),
    originalEnd = pool.end.bind(pool);
  (pool as any).query = async (sql: string, params?: any[]) => {
    const release = await lock();
    try {
      return await query(sql, params);
    } finally {
      release();
    }
  };
  (pool as any).connect = async () => {
    const release = await lock();
    return {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes(";") && !params) {
          await db.exec(sql);
          return { rows: [], rowCount: 0 };
        }
        return query(sql, params);
      },
      release,
    };
  };
  (pool as any).end = async () => {};
  return {
    db,
    close: async () => {
      (pool as any).query = originalQuery;
      (pool as any).connect = originalConnect;
      (pool as any).end = originalEnd;
      await db.close();
      await originalEnd();
    },
  };
}
