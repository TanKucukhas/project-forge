/**
 * Standalone DB initializer — run with `pnpm db:init`.
 * Applies the idempotent DDL (tables + FTS5 + triggers) to the local SQLite file.
 * Imports only ddl.ts (no `server-only`) so it runs cleanly under tsx.
 */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { DDL } from "../src/db/ddl";

const DB_PATH = process.env.PROJECTFORGE_DB ?? path.join(process.cwd(), "data", "projectforge.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.exec(DDL);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name")
  .all()
  .map((r: unknown) => (r as { name: string }).name);

console.log(`✓ Initialized ${DB_PATH}`);
console.log(`  objects: ${tables.join(", ")}`);
db.close();
