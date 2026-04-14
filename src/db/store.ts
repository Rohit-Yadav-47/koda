import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

const DATA_DIR = join(homedir(), '.koda');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'koda.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');
db.pragma('cache_size = -65536');

const insertMessage = db.prepare(
  'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)'
);
const insertConversation = db.prepare('INSERT INTO conversations (title, project_root) VALUES (?, ?)');
const selectById = db.prepare('SELECT * FROM messages WHERE id = ?');
const selectConversation = db.prepare('SELECT * FROM conversations WHERE id = ?');

// Migrations
db.exec(`
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

// --- Config ---
export function getConfig(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

export function getAllConfig(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM config').all() as any[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// --- Conversations ---
export interface Conversation {
  id: number;
  title: string;
  project_root: string | null;
  created_at: string;
}

export function createConversation(title: string, projectRoot: string): Conversation {
  const info = insertConversation.run(title, projectRoot);
  return selectConversation.get(info.lastInsertRowid) as Conversation;
}

export function listConversations(): Conversation[] {
  return db.prepare('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 20').all() as Conversation[];
}

export function getConversation(id: number): Conversation | undefined {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined;
}

export function deleteConversation(id: number): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
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

export function addMessage(conversationId: number, role: string, content: string | null, toolCalls?: any[], toolCallId?: string): Message {
  const info = insertMessage.run(conversationId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, toolCallId ?? null);
  return selectById.get(info.lastInsertRowid) as Message;
}

export function getMessages(conversationId: number): Message[] {
  return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as Message[];
}

export function clearMessages(conversationId: number): void {
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
}
