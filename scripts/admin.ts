import { pool } from "../server/db";
import { passwordHash } from "../server/security";
import { randomUUID } from "node:crypto";
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error(
      "Set ADMIN_EMAIL and a non-empty ADMIN_PASSWORD in your private environment.",
    );
  await pool.query(
    "INSERT INTO admins(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash",
    [randomUUID(), email, await passwordHash(password)],
  );
  await pool.query(
    "DELETE FROM admin_sessions WHERE admin_id=(SELECT id FROM admins WHERE email=$1)",
    [email],
  );
  console.log(
    "Admin account created or password reset; existing sessions revoked. Remove ADMIN_PASSWORD from environment after use.",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
