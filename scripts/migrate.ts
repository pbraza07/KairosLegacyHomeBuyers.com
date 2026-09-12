import { pool } from "../server/db";
import { readdir, readFile } from "node:fs/promises";
import { defaultContent } from "../shared/content";
export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(791234)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        !(
          await c.query("SELECT name FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      ) {
        await c.query(await readFile(`migrations/${name}`, "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      }
    }
    await c.query(
      "INSERT INTO site_content(id,content) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",
      [defaultContent],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("Migrations applied."))
    .catch(() => {
      console.error("Migration failed. Check database configuration.");
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
