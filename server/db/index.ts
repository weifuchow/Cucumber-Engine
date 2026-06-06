import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export const DB_PATH = process.env.CUCUMBER_DB ?? resolve(repoRoot, "data", "cucumber.db");
const SCHEMA_PATH = resolve(here, "schema.sql");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function applySchema(): void {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(sql);
}

applySchema();
