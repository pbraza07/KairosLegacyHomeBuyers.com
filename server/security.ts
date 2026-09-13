import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHmac,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
const scrypt = promisify(rawScrypt);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected = process.env.APP_ORIGIN;
  const origin = req.get("origin");
  if (!expected || origin !== new URL(expected).origin)
    return void res
      .status(403)
      .json({ error: "Please submit from this website." });
  if (!req.is("application/json"))
    return void res.status(415).json({ error: "JSON content required." });
  next();
}
export function rateLimit(scope: string, max: number, minutes: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = createHmac("sha256", process.env.SESSION_SECRET!)
        .update(`${scope}:${req.ip}`)
        .digest("hex");
      const r = await pool.query(
        `INSERT INTO rate_buckets(key,hits,expires_at) VALUES($1,1,now()+($2*interval '1 minute')) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_buckets.expires_at<now() THEN 1 ELSE rate_buckets.hits+1 END,expires_at=CASE WHEN rate_buckets.expires_at<now() THEN now()+($2*interval '1 minute') ELSE rate_buckets.expires_at END RETURNING hits`,
        [key, minutes],
      );
      if (r.rows[0].hits > max) {
        res.set("Retry-After", String(minutes * 60));
        res
          .status(429)
          .json({
            error:
              "Too many attempts. Please wait a while before trying again, or contact us directly.",
          });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("kairos_admin="))
      ?.slice(13);
    if (!token) return void res.status(401).json({ error: "Please sign in." });
    const r = await pool.query(
      "SELECT admin_id,csrf FROM admin_sessions WHERE token_hash=$1 AND expires_at>now()",
      [digest(token)],
    );
    if (!r.rowCount)
      return void res
        .status(401)
        .json({ error: "Your session expired. Please sign in again." });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("x-csrf-token") !== r.rows[0].csrf
    )
      return void res
        .status(403)
        .json({ error: "Please refresh and sign in again." });
    res.locals.session = { ...r.rows[0], tokenHash: digest(token) };
    next();
  } catch (e) {
    next(e);
  }
}
