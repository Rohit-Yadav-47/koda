import chalk from 'chalk';
import * as ui from './index.js';

export interface CmdDef {
  cmd: string;
  alias?: string;
  args?: string;
  desc: string;
}

export const COMMANDS: CmdDef[] = [
  { cmd: '/help',    alias: '/h',  desc: 'Show help' },
  { cmd: '/new',     alias: '/n',  args: '[title]',     desc: 'New conversation' },
  { cmd: '/history', alias: '/ls', desc: 'List conversations' },
  { cmd: '/switch',  alias: '/s',  args: '<id>',        desc: 'Resume conversation' },
  { cmd: '/delete',  alias: '/d',  args: '<id>',        desc: 'Delete conversation' },
  { cmd: '/clear',                 desc: 'Clear messages' },
  { cmd: '/messages',alias: '/m',  desc: 'Show messages' },
  { cmd: '/compact',              desc: 'Compress old messages to save tokens' },
  { cmd: '/tokens',               desc: 'Show context window usage' },
  { cmd: '/retry',   alias: '/r',  desc: 'Resend last message' },
  { cmd: '/fork',                  desc: 'Branch conversation' },
  { cmd: '/future',               args: '<min> <msg>',  desc: 'Send message after delay' },
  { cmd: '/loop',                  args: '<min> <msg>',  desc: 'Repeat message on interval' },
  { cmd: '/loops',                 desc: 'List active loops' },
  { cmd: '/stop',                  args: '<id|all>',     desc: 'Stop a loop' },
  { cmd: '/undo',                   desc: 'Revert last file change' },
  { cmd: '/inject',                args: '<file>',       desc: 'Inject file content into next message' },
  { cmd: '/add',                   args: '<file>',       desc: 'Pin file into context permanently' },
  { cmd: '/context',               desc: 'Show pinned context files' },
  { cmd: '/drop',                  args: '<file|all>',   desc: 'Unpin a context file' },
  { cmd: '/ask',                   desc: 'Toggle read-only mode (no writes)' },
  { cmd: '/plan',                  args: '<task>',       desc: 'Agent plans first, you approve, then executes' },
  { cmd: '/commit',                desc: 'Auto-generate commit message and commit' },
  { cmd: '/review',                desc: 'Agent reviews staged git changes' },
  { cmd: '/test',                  args: '[command]',    desc: 'Run tests, auto-fix failures' },
  { cmd: '/run',     alias: '/!',  args: '<command>',    desc: 'Run shell command' },
  { cmd: '/diff',                  desc: 'Show git diff' },
  { cmd: '/status',                desc: 'Show git status' },
  { cmd: '/copy',                  desc: 'Copy last response' },
  { cmd: '/export',               args: '[file]',       desc: 'Export to markdown' },
  { cmd: '/config',  alias: '/c',  args: 'set|show',    desc: 'Manage config' },
  { cmd: '/model',                 args: '<name>',       desc: 'Switch model' },
  { cmd: '/auto',                  desc: 'Toggle auto-approve' },
  { cmd: '/project', alias: '/p',  args: '[path]',       desc: 'Change project' },
  { cmd: '/profile',              args: '<name>',       desc: 'Switch model profile' },
  { cmd: '/profiles',              desc: 'List saved profiles' },
  { cmd: '/setup',                 desc: 'Re-run setup wizard' },
  { cmd: '/mcp',                   args: 'list|add|remove|restart', desc: 'Manage MCP servers' },
  { cmd: '/quit',    alias: '/q',  desc: 'Exit' },
];

const ALL_NAMES = COMMANDS.flatMap(c => [c.cmd, c.alias].filter(Boolean) as string[]);

// Tab completer for readline
export function completer(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const hits = ALL_NAMES.filter(c => c.startsWith(line));
  return [hits.length ? hits : ALL_NAMES, line];
}

// How many suggestion lines we rendered last time (for cleanup)
let lastRenderedLines = 0;

// Clear previously rendered suggestions
export function clearSuggestions() {
  if (lastRenderedLines > 0) {
    // Save cursor, move down, clear lines, restore cursor
    process.stdout.write('\x1b[s'); // save cursor position
    for (let i = 0; i < lastRenderedLines; i++) {
      process.stdout.write('\n\x1b[K'); // move down and clear line
    }
    process.stdout.write('\x1b[u'); // restore cursor position
    // Now clear downward from cursor
    process.stdout.write('\x1b[J'); // clear from cursor to end of screen
    lastRenderedLines = 0;
  }
}

// Render live suggestions below the current prompt line
export function renderSuggestions(currentLine: string, selectedIdx: number = 0) {
  clearSuggestions();

  if (!currentLine.startsWith('/') || currentLine.includes(' ')) return;

  const query = currentLine.toLowerCase();
  const filtered = COMMANDS.filter(c =>
    c.cmd.startsWith(query) || (c.alias?.startsWith(query))
  );

  if (filtered.length === 0 || (filtered.length === 1 && filtered[0].cmd === currentLine)) return;

  const maxShow = Math.min(filtered.length, 8);
  const lines: string[] = [];

  for (let i = 0; i < maxShow; i++) {
    const c = filtered[i];
    const isSelected = i === selectedIdx;
    const prefix = isSelected ? ` ${ui.icon.arrow}` : '  ';
    const name = isSelected ? chalk.white.bold(c.cmd) : ui.c.accent(c.cmd);
    const alias = c.alias ? ui.c.dim(` ${c.alias}`) : '';
    const args = c.args ? ui.c.dim(` ${c.args}`) : '';
    const desc = ui.c.dim(` — ${c.desc}`);
    lines.push(`${prefix} ${name}${alias}${args}${desc}`);
  }

  if (filtered.length > maxShow) {
    lines.push(ui.c.dim(`   ... ${filtered.length - maxShow} more`));
  }

  // Render below cursor without moving it
  process.stdout.write('\x1b[s'); // save cursor
  process.stdout.write('\n' + lines.join('\n'));
  process.stdout.write('\x1b[u'); // restore cursor
  lastRenderedLines = lines.length;
}

// Get the filtered command at index (for Tab/Enter selection)
export function getFilteredCommand(currentLine: string, selectedIdx: number): CmdDef | null {
  if (!currentLine.startsWith('/')) return null;
  const query = currentLine.toLowerCase();
  const filtered = COMMANDS.filter(c =>
    c.cmd.startsWith(query) || (c.alias?.startsWith(query))
  );
  return filtered[selectedIdx] ?? null;
}

export function getFilteredCount(currentLine: string): number {
  if (!currentLine.startsWith('/')) return 0;
  const query = currentLine.toLowerCase();
  return COMMANDS.filter(c =>
    c.cmd.startsWith(query) || (c.alias?.startsWith(query))
  ).length;
}
