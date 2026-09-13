import { pool } from "./db";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultContent } from "../shared/content";

/**
 * Apply every migration exactly once. The advisory lock makes this safe when
 * more than one Render instance starts at the same time. Migrations are
 * intentionally additive; no destructive down-migrations run automatically.
 */
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(791234)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );

    const migrationsDirectory = resolve(process.cwd(), "migrations");
    const names = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of names) {
      const alreadyApplied = await client.query(
        "SELECT name FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (alreadyApplied.rowCount) continue;

      await client.query(
        await readFile(resolve(migrationsDirectory, name), "utf8"),
      );
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
    }

    await client.query(
      "INSERT INTO site_content(id,content) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",
      [defaultContent],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
