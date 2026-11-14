// Korie's database: people, folders, what's in them, and what everyone watched.
// Node's own SQLite (node:sqlite): nothing native to build, on any machine.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA } from "./config.ts";

const raw = new DatabaseSync(path.join(DATA, "korie.db"));

export const db = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare: (sql: string): any => raw.prepare(sql),
  exec: (sql: string) => raw.exec(sql),
  /** fn runs in one transaction: all of it is saved, or none. */
  transaction: (fn: () => void) => () => {
    raw.exec("BEGIN");
    try {
      fn();
      raw.exec("COMMIT");
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
  },
};
raw.exec("PRAGMA journal_mode = WAL");
raw.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, pin TEXT,
  admin INTEGER NOT NULL DEFAULT 0, can_settings INTEGER NOT NULL DEFAULT 0,
  addons TEXT NOT NULL DEFAULT '"all"', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  device TEXT, created INTEGER NOT NULL, seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  scanned INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, folder INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  parent TEXT, file TEXT, title TEXT NOT NULL, sort TEXT NOT NULL, year TEXT NOT NULL DEFAULT '',
  added INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}', seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS items_kind ON items(kind);
CREATE INDEX IF NOT EXISTS items_parent ON items(parent);
CREATE TABLE IF NOT EXISTS progress (
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, item TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL, snapshot TEXT, PRIMARY KEY (person, item));
CREATE TABLE IF NOT EXISTS favourites (
  person TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, item TEXT NOT NULL,
  added INTEGER NOT NULL, snapshot TEXT, PRIMARY KEY (person, item));
CREATE TABLE IF NOT EXISTS addons (
  id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, internet INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}', changed INTEGER NOT NULL DEFAULT 0);
`);

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

const getS = db.prepare("SELECT value FROM settings WHERE key = ?");
const setS = db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

export const DEFAULTS: Record<string, unknown> = {
  server_name: "Korie",
  language: "en-US",
  tmdb_key: "",
  scan_on_start: true,
};

export function setting<T = unknown>(key: string): T {
  const r = getS.get(key) as { value: string } | undefined;
  return (r ? JSON.parse(r.value) : DEFAULTS[key]) as T;
}

export function setSetting(key: string, value: unknown): void {
  setS.run(key, JSON.stringify(value));
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
