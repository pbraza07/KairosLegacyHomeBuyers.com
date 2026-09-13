import { testDatabase } from "../tests/database";
import { migrate } from "./migrate";
import { pool } from "../server/db";
import { passwordHash } from "../server/security";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
process.env.SESSION_SECRET = "local-test-session-secret-not-for-production";
process.env.DATABASE_URL = "postgresql://test-only";
await testDatabase();
await migrate();
await pool.query(
  "INSERT INTO admins(id,email,password_hash) VALUES($1,$2,$3)",
  [
    randomUUID(),
    "admin@example.test",
    await passwordHash("test-password-long-enough"),
  ],
);
await import("../server/index");
