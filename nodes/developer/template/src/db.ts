/**
 * Per-node SQLite store — the brAIn convention for any persistent
 * state beyond `ctx.state`. Lives under `ctx.dataDir` (sandboxed +
 * survives process restart + travels with the data root).
 *
 * Usage in handler.ts:
 *
 *   import { openDb } from "./db";
 *   const db = openDb(ctx.dataDir);          // lazy-opens once per instance
 *   db.prepare("INSERT INTO items …").run(…);
 *   const rows = db.prepare("SELECT * FROM items").all();
 *
 * Delete this file (and the better-sqlite3 dep in package.json) if
 * your node doesn't need a DB — many don't, ctx.state is enough for
 * small per-instance KV.
 *
 * Pattern reference: storeprojects/brAIn-perception/nodes/intent/src/store.ts.
 */
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const DB_FILENAME = "store.db";

/** Per-(dataDir) handle cache so repeated openDb(ctx.dataDir) calls
 *  inside the same process share one connection — better-sqlite3 is
 *  synchronous + cheap to keep open, but holding multiple handles to
 *  the same file is a known footgun (locking). */
const handles = new Map<string, Database.Database>();

/**
 * Open (or reuse) the per-node SQLite database under `dataDir`. Runs
 * the schema migration once on first open. Always returns a usable
 * handle; throws only on disk-full / permission errors.
 */
export function openDb(dataDir: string): Database.Database {
  const dbPath = path.join(dataDir, DB_FILENAME);
  const existing = handles.get(dbPath);
  if (existing && existing.open) return existing;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");      // safer concurrent reads + faster writes
  db.pragma("foreign_keys = ON");
  migrate(db);
  handles.set(dbPath, db);
  return db;
}

/**
 * Bring the schema up to date. CREATE TABLE IF NOT EXISTS is the
 * forward-compatible idiom; add ALTER TABLE branches at the bottom
 * for columns added after v1 (see packages/core/src/db/database.ts).
 *
 * Replace this with your node's real schema.
 */
function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT NOT NULL UNIQUE,
      value       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_key ON items(key);
  `);
}

/** Close the per-dataDir handle. Safe to call from teardown(). */
export function closeDb(dataDir: string): void {
  const dbPath = path.join(dataDir, DB_FILENAME);
  const db = handles.get(dbPath);
  if (!db) return;
  try { db.close(); } catch { /* already closed */ }
  handles.delete(dbPath);
}
