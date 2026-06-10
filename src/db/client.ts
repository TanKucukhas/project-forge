/**
 * Local SQLite connection (server-only). The DB file lives in `data/` and is
 * never committed. `initDb()` applies the idempotent DDL on first access so the
 * index can always be rebuilt from the Markdown library.
 */
import "server-only";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DDL } from "./ddl";
import * as schema from "./schema";

const DB_PATH = process.env.PROJECTFORGE_DB ?? path.join(process.cwd(), "data", "projectforge.sqlite");

let sqlite: Database.Database | null = null;

function connect(): Database.Database {
  if (sqlite) return sqlite;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(DDL);
  ensureColumn(conn, "sources", "thumbnail", "TEXT");
  sqlite = conn;
  return conn;
}

/**
 * Additive migration helper: add a column to an existing table if it's missing.
 * `CREATE TABLE IF NOT EXISTS` never alters an already-created table, so columns
 * introduced after a DB was first built are added here (idempotent).
 */
function ensureColumn(
  conn: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function initDb(): void {
  connect();
}

export const db = drizzle(connect(), { schema });
export { schema };
