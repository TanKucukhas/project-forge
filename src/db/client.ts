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
  sqlite = conn;
  return conn;
}

export function initDb(): void {
  connect();
}

export const db = drizzle(connect(), { schema });
export { schema };
