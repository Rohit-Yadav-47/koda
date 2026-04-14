import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Markdown renderer for terminal
const marked = new Marked(markedTerminal({
  reflowText: true,
  width: Math.min(process.stdout.columns || 80, 100) - 4,
  showSectionPrefix: false,
}) as any);

export function renderMarkdown(text: string): string {
  try {
    return (marked.parse(text) as string).trim();
  } catch {
    return text;
  }
}

// Colors
export const c = {
  brand: chalk.hex('#a855f7'),
  brandBold: chalk.hex('#a855f7').bold,
  accent: chalk.hex('#3b82f6'),
  success: chalk.hex('#22c55e'),
  warn: chalk.hex('#eab308'),
  error: chalk.hex('#ef4444'),
  dim: chalk.dim,
  bold: chalk.bold,
  code: chalk.hex('#e879f9'),
  file: chalk.hex('#60a5fa'),
  tool: chalk.hex('#f59e0b'),
};

// Icons
export const icon = {
  check: chalk.hex('#22c55e')('✓'),
  cross: chalk.hex('#ef4444')('✗'),
  arrow: chalk.hex('#a855f7')('❯'),
  dot: chalk.dim('·'),
  bar: chalk.dim('│'),
  dash: chalk.dim('─'),
  warn: chalk.hex('#eab308')('⚠'),
  info: chalk.hex('#3b82f6')('ℹ'),
  tool: chalk.hex('#f59e0b')('⚡'),
  chat: chalk.hex('#a855f7')('●'),
  thinking: chalk.hex('#a855f7')('◆'),
};

// Logo only
export function logo() {
  console.log(`
${chalk.hex('#a855f7').bold('  ██╗  ██╗ ██████╗ ██████╗  █████╗ ')}
${chalk.hex('#b065f7').bold('  ██║ ██╔╝██╔═══██╗██╔══██╗██╔══██╗')}
${chalk.hex('#ba75f7').bold('  █████╔╝ ██║   ██║██║  ██║███████║')}
${chalk.hex('#c485f7').bold('  ██╔═██╗ ██║   ██║██║  ██║██╔══██║')}
${chalk.hex('#ce95f7').bold('  ██║  ██╗╚██████╔╝██████╔╝██║  ██║')}
${chalk.hex('#d8a5f7').bold('  ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝')}
${chalk.dim('           AI Coding Agent')}
`);
}

// Status bar (shown after setup or on normal start)
export function statusBar(project: string, model: string, api: string) {
  console.log(`  ${c.dim('Project')}  ${chalk.white(project)}`);
  console.log(`  ${c.dim('Model')}    ${chalk.white(model)}`);
  console.log(`  ${c.dim('API')}      ${chalk.white(api)}`);
  console.log();
  console.log(`  ${c.dim('Type a message to chat, or')} ${chalk.cyan('/help')} ${c.dim('for commands')}`);
  console.log();
}

// Tool display
export function toolStart(name: string, argsPreview: string) {
  return `  ${icon.tool} ${c.tool(name)} ${c.dim(argsPreview)}`;
}

export function toolDone(name: string, argsPreview: string) {
  return `  ${icon.check} ${c.tool(name)} ${c.dim(argsPreview)}`;
}

export function toolFail(name: string, error: string) {
  return `  ${icon.cross} ${c.tool(name)} ${c.error(error)}`;
}

export function toolPreview(content: string, maxLines = 12) {
  const lines = content.split('\n');
  const preview = lines.slice(0, maxLines);
  const more = lines.length > maxLines ? `\n  ${c.dim(`  ... ${lines.length - maxLines} more lines`)}` : '';
  return preview.map(l => `  ${icon.bar}  ${c.dim(l)}`).join('\n') + more;
}

// Prompt
export function getPrompt(convoId: number | null): string {
  const tag = convoId ? c.dim(`#${convoId} `) : '';
  return `${tag}${c.brandBold('you')} ${icon.arrow} `;
}

// Agent header
export function agentHeader(): string {
  return `\n${c.brandBold('koda')} ${icon.arrow} `;
}

// Stats
export function statsLine(toolCalls: number, elapsed: number): string {
  const parts = [];
  if (toolCalls > 0) parts.push(`${toolCalls} tool calls`);
  parts.push(`${(elapsed / 1000).toFixed(1)}s`);
  return `\n  ${c.dim(parts.join(' · '))}`;
}

// Config table
export function configTable(cfg: Record<string, string>) {
  console.log();
  for (const [k, v] of Object.entries(cfg)) {
    const display = k === 'api_key' ? v.slice(0, 12) + '...' : v;
    console.log(`  ${c.accent(k.padEnd(16))} ${display}`);
  }
  if (Object.keys(cfg).length === 0) {
    console.log(`  ${c.dim('No config set.')}`);
  }
  console.log();
}

// Conversation list
export function convoList(convos: any[], activeId: number | null) {
  console.log();
  for (const c2 of convos) {
    const active = activeId === c2.id;
    const marker = active ? icon.chat : c.dim(' ');
    const id = active ? chalk.white.bold(`#${c2.id}`) : c.dim(`#${c2.id}`);
    const title = active ? chalk.white(c2.title) : c.dim(c2.title);
    const msgs = c.dim(`${c2.msgCount || 0} msgs`);
    console.log(`  ${marker} ${id}  ${title}  ${msgs}`);
  }
  console.log();
}

// Permission prompt
export function permissionText(toolName: string, argsPreview: string): string {
  return `\n  ${icon.warn} ${c.warn('Allow')} ${c.tool.bold(toolName)}${c.dim('(')}${c.dim(argsPreview)}${c.dim(')')}${c.warn('?')} ${c.dim('[Y/n]')} `;
}

// Permission prompt with accept-all for write operations (shown after diff preview)
export function diffPermissionText(toolName: string, argsPreview: string): string {
  return `\n  ${icon.warn} ${c.warn('Allow')} ${c.tool.bold(toolName)}${c.dim('(')}${c.dim(argsPreview)}${c.dim(')')}${c.warn('?')} ${c.dim('[y]es / [n]o / [a]ccept all')} `;
}

// MCP server display
export function mcpServerList(servers: { name: string; toolCount: number; tools: string[] }[]) {
  if (servers.length === 0) {
    console.log(c.dim('\n  No MCP servers connected.\n'));
    return;
  }
  console.log();
  for (const s of servers) {
    console.log(`  ${icon.chat} ${chalk.white.bold(s.name)} ${c.dim(`(${s.toolCount} tools)`)}`);
    for (const t of s.tools) {
      console.log(`    ${c.dim('•')} ${c.tool(t)}`);
    }
  }
  console.log();
}

export function mcpConfigList(servers: Record<string, any>) {
  const names = Object.keys(servers);
  if (names.length === 0) {
    console.log(c.dim('\n  No MCP servers configured. Use /mcp add <name> <command> [args...]\n'));
    return;
  }
  console.log();
  for (const name of names) {
    const s = servers[name];
    const cmd = [s.command, ...(s.args || [])].join(' ');
    console.log(`  ${icon.dot} ${chalk.white(name)} ${c.dim(cmd)}`);
  }
  console.log();
}

// Thinking indicator
let thinkingSpinner: ReturnType<typeof ora> | null = null;

export function thinkingStart() {
  if (thinkingSpinner) thinkingSpinner.stop();
  thinkingSpinner = ora({
    text: `${c.brand('thinking...')}`,
    indent: 2,
    spinner: 'dots',
  }).start();
}

export function thinkingEnd() {
  if (thinkingSpinner) {
    thinkingSpinner.stop();
    thinkingSpinner = null;
  }
}

export function thinkingUpdate(text: string) {
  if (thinkingSpinner) {
    thinkingSpinner.text = text;
  }
}

// Strip thinking tags and return styled version + plain content
export function processThinkingTags(text: string): { styled: string; plain: string } {
  const THINKING_REGEX = /<thinking>([\s\S]*?)<\/thinking>/gi;
  let plain = text.replace(THINKING_REGEX, '');
  let styled = text.replace(THINKING_REGEX, (_match, content) => {
    return `\n${c.dim(`💭 ${content.trim()}`)}\n`;
  });
  return { styled, plain };
}
