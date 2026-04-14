import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = join(homedir(), '.koda');
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'koda.db');

let db: SqlJsDatabase;
let dbReady: Promise<void>;

async function initDb() {
  const SQL = await initSqlJs();

  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer as any);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Chat',
      project_root TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  saveDb();
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

function runAsync(fn: () => void) {
  if (!db) throw new Error('Database not initialized');
  fn();
  saveDb();
}

dbReady = initDb();

export async function waitForDb(): Promise<void> {
  await dbReady;
}

// --- Config ---
export function getConfig(key: string): string | undefined {
  if (!db) return undefined;
  const result = db.exec('SELECT value FROM config WHERE key = ?', [key]);
  return result[0]?.values[0]?.[0] as string | undefined;
}

export function setConfig(key: string, value: string): void {
  runAsync(() => {
    db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, value]);
  });
}

export function getAllConfig(): Record<string, string> {
  if (!db) return {};
  const result = db.exec('SELECT key, value FROM config');
  const out: Record<string, string> = {};
  if (result[0]) {
    for (const row of result[0].values) {
      out[row[0] as string] = row[1] as string;
    }
  }
  return out;
}

// --- Conversations ---
export interface Conversation {
  id: number;
  title: string;
  project_root: string | null;
  created_at: string;
}

function rowToConversation(values: any[]): Conversation {
  return {
    id: values[0] as number,
    title: values[1] as string,
    project_root: values[2] as string | null,
    created_at: values[3] as string,
  };
}

export function createConversation(title: string, projectRoot: string): Conversation {
  if (!db) throw new Error('DB not ready');
  db.run('INSERT INTO conversations (title, project_root) VALUES (?, ?)', [title, projectRoot]);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
  saveDb();
  const result = db.exec('SELECT * FROM conversations WHERE id = ?', [id]);
  return rowToConversation(result[0].values[0]);
}

export function listConversations(): Conversation[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 20');
  if (!result[0]) return [];
  return result[0].values.map((row: any[]) => rowToConversation(row));
}

export function getConversation(id: number): Conversation | undefined {
  if (!db) return undefined;
  const result = db.exec('SELECT * FROM conversations WHERE id = ?', [id]);
  if (!result[0]?.values[0]) return undefined;
  return rowToConversation(result[0].values[0]);
}

export function deleteConversation(id: number): void {
  runAsync(() => {
    db.run('DELETE FROM conversations WHERE id = ?', [id]);
  });
}

// --- Messages ---
export interface Message {
  id: number;
  conversation_id: number;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

function rowToMessage(values: any[]): Message {
  return {
    id: values[0] as number,
    conversation_id: values[1] as number,
    role: values[2] as string,
    content: values[3] as string | null,
    tool_calls: values[4] as string | null,
    tool_call_id: values[5] as string | null,
    created_at: values[6] as string,
  };
}

export function addMessage(conversationId: number, role: string, content: string | null, toolCalls?: any[], toolCallId?: string): Message {
  if (!db) throw new Error('DB not ready');
  db.run(
    'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)',
    [conversationId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, toolCallId ?? null]
  );
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
  saveDb();
  const result = db.exec('SELECT * FROM messages WHERE id = ?', [id]);
  return rowToMessage(result[0].values[0]);
}

export function getMessages(conversationId: number): Message[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [conversationId]);
  if (!result[0]) return [];
  return result[0].values.map((row: any[]) => rowToMessage(row));
}

export function clearMessages(conversationId: number): void {
  runAsync(() => {
    db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
  });
}
