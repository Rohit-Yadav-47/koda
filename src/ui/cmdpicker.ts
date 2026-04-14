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

export function completer(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const hits = ALL_NAMES.filter(c => c.startsWith(line));
  return [hits.length ? hits : ALL_NAMES, line];
}
