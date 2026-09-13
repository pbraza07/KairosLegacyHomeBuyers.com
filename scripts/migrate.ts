import { pool } from "../server/db";
import { migrate } from "../server/migrate";
export { migrate };
if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("Migrations applied."))
    .catch(() => {
      console.error("Migration failed. Check database configuration.");
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
