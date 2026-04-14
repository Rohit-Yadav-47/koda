import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { execSync } from 'child_process';
import { resolve, relative, dirname, isAbsolute, join } from 'path';
import { minimatch } from 'minimatch';

// --- Undo stack ---
export interface FileChange {
  path: string;
  previousContent: string | null; // null means file didn't exist
  timestamp: number;
  tool: string;
}

const undoStack: FileChange[] = [];

export function getUndoStack(): FileChange[] { return undoStack; }
export function popUndo(): FileChange | undefined { return undoStack.pop(); }

// --- Sandbox ---
function safe(root: string, target: string): string {
  const resolved = isAbsolute(target) ? target : resolve(root, target);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Cannot access "${target}" — it's outside the project directory.\n` +
      `  Project: ${root}\n` +
      `  Tip: Change project with /project <path> to work in a different directory.`
    );
  }
  return resolved;
}

// --- Tool implementations ---

function readFile(args: any, root: string): string {
  const p = safe(root, args.path);
  const content = readFileSync(p, 'utf-8');
  const lines = content.split('\n');
  const start = args.offset ?? 0;
  const end = args.limit ? start + args.limit : lines.length;
  return lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join('\n');
}

function writeFile(args: any, root: string): string {
  const p = safe(root, args.path);
  const prev = existsSync(p) ? readFileSync(p, 'utf-8') : null;
  undoStack.push({ path: p, previousContent: prev, timestamp: Date.now(), tool: 'write_file' });
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, args.content, 'utf-8');
  return `Wrote ${args.content.length} bytes to ${args.path}`;
}

function editFile(args: any, root: string): string {
  const p = safe(root, args.path);
  const content = readFileSync(p, 'utf-8');
  if (!content.includes(args.old_string)) throw new Error(`String not found in ${args.path}`);
  const firstIdx = content.indexOf(args.old_string);
  const nextIdx = content.indexOf(args.old_string, firstIdx + 1);
  if (nextIdx !== -1) throw new Error(`Found multiple matches — be more specific`);
  undoStack.push({ path: p, previousContent: content, timestamp: Date.now(), tool: 'edit_file' });
  const updated = content.replace(args.old_string, args.new_string);
  writeFileSync(p, updated, 'utf-8');
  return `Edited ${args.path}: replaced ${args.old_string.length} chars`;
}

function runTerminal(args: any, root: string): Promise<string> {
  const cwd = args.cwd ? safe(root, args.cwd) : root;
  const timeout = Math.min(args.timeout_ms ?? 30000, 120000);

  return new Promise((resolve) => {
    exec(args.command, { cwd, timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error) {
        const out = (stdout || '') + '\n' + (stderr || '');
        resolve(`Exit code ${error.code ?? 1}\n${out}`.trim());
      } else {
        const result = stdout.length > 8000
          ? stdout.slice(0, 4000) + '\n...[truncated]...\n' + stdout.slice(-4000)
          : stdout;
        resolve(result || '(no output)');
      }
    });
  });
}

function searchCode(args: any, root: string): string {
  const pattern = new RegExp(args.pattern, 'gi');
  const searchRoot = args.path ? safe(root, args.path) : root;
  const results: string[] = [];
  const ctx = args.context_lines ?? 0;
  const MAX_RESULTS = 50;

  function walk(dir: string) {
    if (results.length >= MAX_RESULTS) return;
    for (const entry of readdirSync(dir)) {
      if (results.length >= MAX_RESULTS) return;
      if (['node_modules', '.git', 'dist', '.next', '__pycache__'].includes(entry)) continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          walk(full);
        } else if (s.isFile() && s.size < 500000) {
          const content = readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].length > 10000) continue;
            pattern.lastIndex = 0;
            if (pattern.test(lines[i])) {
              const rel = relative(root, full);
              const start = Math.max(0, i - ctx);
              const end = Math.min(lines.length, i + ctx + 1);
              const snippet = lines.slice(start, end).map((l, j) => `${start + j + 1}\t${l}`).join('\n');
              results.push(`${rel}:${i + 1}\n${snippet}`);
              pattern.lastIndex = 0;
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
  }

  walk(searchRoot);
  return results.length ? results.join('\n---\n') : 'No matches found.';
}

function globFiles(args: any, root: string): string {
  const results: string[] = [];

  function walk(dir: string) {
    if (results.length > 200) return;
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.next'].includes(entry)) continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        const rel = relative(root, full);
        if (minimatch(rel, args.pattern)) results.push(rel);
        if (s.isDirectory()) walk(full);
      } catch { /* skip */ }
    }
  }

  walk(root);
  return results.length ? results.join('\n') : 'No files matched.';
}

function speak(args: any, _root: string): string {
  const text = args.text;
  if (!text || text.trim().length === 0) return 'No text provided to speak.';
  const voice = args.voice || '';
  const rate = args.rate || 200;
  const sayCmd = voice
    ? `say -v "${voice.replace(/"/g, '')}" -r ${rate} "${text.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`
    : `say -r ${rate} "${text.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`;
  try {
    execSync(sayCmd, { timeout: 30000 });
    return `Spoke: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`;
  } catch (e: any) {
    return `Speech failed: ${e.message}`;
  }
}

function gitOps(args: any, root: string): string {
  const op = args.operation;
  const cmdMap: Record<string, string> = {
    status: 'git status --short',
    diff: 'git diff',
    log: 'git log --oneline -20',
    add: `git add ${args.args || '.'}`,
    commit: `git commit -m "${(args.args || 'update').replace(/"/g, '\\"')}"`,
    branch: 'git branch -a',
    checkout: `git checkout ${args.args || ''}`,
  };
  const cmd = cmdMap[op];
  if (!cmd) throw new Error(`Unknown git operation: ${op}`);
  return execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 15000 }).trim() || '(no output)';
}

// --- Tool schemas (OpenAI function calling format) ---
export const toolSchemas = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a file. Returns content with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          offset: { type: 'integer', description: 'Start line (0-indexed)' },
          limit: { type: 'integer', description: 'Max lines to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating directories as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: 'Find and replace a unique string in a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_string: { type: 'string', description: 'Exact string to find' },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_terminal',
      description: 'Execute a shell command and return output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
          timeout_ms: { type: 'integer', description: 'Timeout in ms (default 30s, max 120s)' },
          cwd: { type: 'string', description: 'Working directory (relative to project)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_code',
      description: 'Search for a regex pattern across project files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Subdirectory to search in' },
          context_lines: { type: 'integer', description: 'Lines of context around each match' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'glob_files',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'speak',
      description: 'Speak text aloud using text-to-speech (macOS `say`). Use this to communicate summaries, status updates, or confirmations audibly to the user.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak aloud' },
          voice: { type: 'string', description: 'macOS voice name (e.g. "Samantha", "Alex", "Karen"). Default: system voice' },
          rate: { type: 'integer', description: 'Speech rate in words per minute (default 200, range 100-400)' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_ops',
      description: 'Run a git operation: status, diff, log, add, commit, branch, checkout.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout'] },
          args: { type: 'string', description: 'Additional arguments (e.g. file paths, commit message)' },
        },
        required: ['operation'],
      },
    },
  },
];

// --- Execute a tool (async — run_terminal is truly async, others are sync-wrapped) ---
export async function executeTool(name: string, args: any, projectRoot: string): Promise<string> {
  switch (name) {
    case 'read_file': return readFile(args, projectRoot);
    case 'write_file': return writeFile(args, projectRoot);
    case 'edit_file': return editFile(args, projectRoot);
    case 'run_terminal': return await runTerminal(args, projectRoot);
    case 'search_code': return searchCode(args, projectRoot);
    case 'glob_files': return globFiles(args, projectRoot);
    case 'speak': return speak(args, projectRoot);
    case 'git_ops': return gitOps(args, projectRoot);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// Permission: auto-approve reads, prompt for writes
export const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
