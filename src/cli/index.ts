#!/usr/bin/env node
import chalk from 'chalk';
import { createInterface, emitKeypressEvents } from 'readline';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import {
  getConfig, setConfig, getAllConfig,
  createConversation, listConversations, getConversation, deleteConversation,
  addMessage, getMessages, clearMessages,
  type Conversation,
} from '../db/store.js';
import { runAgent } from '../core/agent.js';
import { popUndo, getUndoStack } from '../tools/index.js';
import * as ui from '../ui/index.js';
import {
  COMMANDS, completer,
  renderSuggestions, clearSuggestions, getFilteredCommand, getFilteredCount,
} from '../ui/cmdpicker.js';
import { needsSetup, runSetup } from '../core/setup.js';
import {
  loadMcpConfig, connectAllServers, disconnectAll, disconnectServer,
  connectServer, addServerConfig, removeServerConfig,
  getConnectedServers, getMcpServerCount,
} from '../mcp/client.js';
import {
  estimateMessageTokens, getContextLimit, compactHistory,
} from '../core/context.js';
import { processThinkingTags, thinkingStart, thinkingEnd, thinkingUpdate } from '../ui/index.js';

// --- State ---
let projectRoot = process.cwd();
let activeConvo: Conversation | null = null;
let history: any[] = [];
let lastUserMessage = '';
let lastAgentResponse = '';
let suggestionIdx = 0;
let readOnlyMode = false;
let activeAbort: AbortController | null = null;
let isAgentRunning = false;
const pinnedFiles: Map<string, string> = new Map();
let pendingInject: string | null = null;
const scheduledTimers: Map<string, NodeJS.Timeout> = new Map();
const loopTimers: Map<string, { timer: NodeJS.Timeout; interval: number; message: string }> = new Map();

// --- Readline ---
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '',
  terminal: true,
  completer,
});

// --- Live suggestions on keypress ---
emitKeypressEvents(process.stdin, rl);
let suggestionsVisible = false;

process.stdin.on('keypress', (_ch, key) => {
  if (!key) return;
  const line = (rl as any).line as string;
  const showingSuggestions = line.startsWith('/') && !line.includes(' ') && getFilteredCount(line) > 0;

  if (key.name === 'return' && suggestionsVisible) {
    const match = getFilteredCommand(line, suggestionIdx);
    if (match && match.cmd !== line) {
      clearSuggestions();
      suggestionsVisible = false;
      suggestionIdx = 0;

      if (match.args) {
        (rl as any).line = match.cmd + ' ';
        (rl as any).cursor = match.cmd.length + 1;
        const promptStr = ui.getPrompt(activeConvo?.id ?? null);
        process.stdout.write(`\r\x1b[K${promptStr}${match.cmd} `);
        key.name = 'ignore';
        return;
      }

      (rl as any).line = match.cmd;
      (rl as any).cursor = match.cmd.length;
      const promptStr = ui.getPrompt(activeConvo?.id ?? null);
      process.stdout.write(`\r\x1b[K${promptStr}${match.cmd}`);
      return;
    }
  }

  if (key.name === 'tab' && showingSuggestions) {
    const match = getFilteredCommand(line, suggestionIdx);
    if (match) {
      (rl as any).line = match.cmd + ' ';
      (rl as any).cursor = match.cmd.length + 1;
      const promptStr = ui.getPrompt(activeConvo?.id ?? null);
      process.stdout.write(`\r\x1b[K${promptStr}${match.cmd} `);
      clearSuggestions();
      suggestionsVisible = false;
      suggestionIdx = 0;
    }
    return;
  }

  if (showingSuggestions) {
    const count = getFilteredCount(line);
    if (key.name === 'down') {
      suggestionIdx = Math.min(count - 1, suggestionIdx + 1);
      renderSuggestions(line, suggestionIdx);
      return;
    }
    if (key.name === 'up' && suggestionIdx > 0) {
      suggestionIdx = Math.max(0, suggestionIdx - 1);
      renderSuggestions(line, suggestionIdx);
      return;
    }
  }

  if (key.name === 'escape' && suggestionsVisible) {
    clearSuggestions();
    suggestionsVisible = false;
    suggestionIdx = 0;
    return;
  }

  setImmediate(() => {
    const updated = (rl as any).line as string;
    if (updated.startsWith('/') && !updated.includes(' ') && updated.length > 0) {
      const count = getFilteredCount(updated);
      if (count > 0) {
        suggestionIdx = Math.min(suggestionIdx, count - 1);
        renderSuggestions(updated, suggestionIdx);
        suggestionsVisible = true;
      } else {
        clearSuggestions();
        suggestionsVisible = false;
      }
    } else {
      if (suggestionsVisible) {
        clearSuggestions();
        suggestionsVisible = false;
        suggestionIdx = 0;
      }
    }
  });
});

// --- Ctrl+C ---
process.on('SIGINT', () => {
  clearSuggestions();
  if (isAgentRunning && activeAbort) {
    activeAbort.abort();
    console.log(ui.c.warn(`\n\n  Stopped.\n`));
    isAgentRunning = false;
    activeAbort = null;
    prompt();
    return;
  }
  console.log(ui.c.dim('\n\n  Interrupted. Type /quit to exit.\n'));
  prompt();
});

function prompt() {
  rl.setPrompt(ui.getPrompt(activeConvo?.id ?? null));
  rl.prompt();
}

// --- Send message to agent ---
async function sendMessage(input: string) {
  if (!activeConvo) {
    const title = input.slice(0, 50).replace(/\n/g, ' ');
    activeConvo = createConversation(title, projectRoot);
  }

  let fullMessage = input;
  if (pendingInject) {
    fullMessage = `<file_context>\n${pendingInject}\n</file_context>\n\n${input}`;
    pendingInject = null;
  }
  if (pinnedFiles.size > 0) {
    const ctx = Array.from(pinnedFiles.entries())
      .map(([path, content]) => `<pinned_file path="${path}">\n${content}\n</pinned_file>`)
      .join('\n\n');
    fullMessage = `${ctx}\n\n${fullMessage}`;
  }

  lastUserMessage = input;
  addMessage(activeConvo.id, 'user', fullMessage);
  thinkingEnd(); // ensure clean state before starting
  thinkingStart();

  const abortController = new AbortController();
  activeAbort = abortController;
  isAgentRunning = true;

  const startTime = Date.now();
  let responseText = '';
  let inThinkingTag = false;
  let writeBuffer = '';
  let hasToolCalls = false;
  const WRITE_FLUSH_INTERVAL = 3;

  const flushBuffer = () => {
    if (writeBuffer.length > 0) {
      process.stdout.write(writeBuffer);
      writeBuffer = '';
    }
  };

  try {
    const { content, messages } = await runAgent(
      fullMessage,
      projectRoot,
      history,
      (token) => {
        if (token === '\n' && hasToolCalls) return;

        let i = 0;
        while (i < token.length) {
          if (inThinkingTag) {
            const endIdx = token.indexOf('</thinking>', i);
            if (endIdx !== -1) {
              i = endIdx + 11;
              inThinkingTag = false;
            } else {
              i = token.length;
            }
          } else {
            const startIdx = token.indexOf('<thinking>', i);
            if (startIdx !== -1) {
              if (startIdx > i) {
                responseText += token.slice(i, startIdx);
                writeBuffer += token.slice(i, startIdx);
                if (writeBuffer.length > WRITE_FLUSH_INTERVAL) flushBuffer();
              }
              i = startIdx + 10;
              inThinkingTag = true;
            } else {
              responseText += token.slice(i);
              writeBuffer += token.slice(i);
              i = token.length;
              if (writeBuffer.length > WRITE_FLUSH_INTERVAL) flushBuffer();
            }
          }
        }
      },
      readOnlyMode,
      (status) => {
        switch (status) {
          case 'calling':
            thinkingUpdate(ui.c.brand('calling model...'));
            break;
          case 'calling_again':
            thinkingStart();
            thinkingUpdate(ui.c.brand('thinking again...'));
            break;
          case 'responding':
            thinkingEnd();
            hasToolCalls = true;
            break;
        }
      },
      abortController.signal,
    );

    flushBuffer();
    thinkingEnd();

    const elapsed = Date.now() - startTime;
    isAgentRunning = false;
    activeAbort = null;

    if (content) {
      const { styled, plain } = processThinkingTags(content);
      console.log(ui.renderMarkdown(styled));
      lastAgentResponse = plain;
    }

    const toolCount = messages.filter(m => m.role === 'tool').length;
    console.log(ui.statsLine(toolCount, elapsed));
    console.log();

    if (content) addMessage(activeConvo.id, 'assistant', content);
    history = messages.filter(m =>
      m.role === 'user' || m.role === 'assistant' || m.role === 'tool'
    );
  } catch (e: any) {
    flushBuffer();
    thinkingEnd();
    isAgentRunning = false;
    activeAbort = null;
    if (e.name === 'AbortError' || abortController.signal.aborted) return;
    console.log();
    if (e.message.includes('API key') || e.message.includes('No API key')) {
      console.log(`\n  ${ui.icon.cross} ${e.message}\n`);
    } else if (e.message.includes('429') || e.message.includes('Rate')) {
      console.log(`\n  ${ui.icon.warn} Rate limited — wait a moment and retry.\n`);
    } else if (e.message.includes('401')) {
      console.log(`\n  ${ui.icon.cross} Invalid API key. Run: ${chalk.cyan('/config set api_key YOUR_KEY')}\n`);
    } else if (e.message.includes('Cannot access') && e.message.includes('outside the project')) {
      console.log(`\n  ${ui.icon.cross} ${ui.c.error(e.message)}\n`);
    } else {
      console.log(`\n  ${ui.icon.cross} ${e.message}\n`);
    }
  }
}

// --- Help ---
function showHelp() {
  console.log(`
  ${chalk.bold.white('Chat')}
  ${ui.c.dim('Type a message and press Enter. Multi-line: start with """ and end with """')}
  ${ui.c.dim('Type / to see all commands with live search.')}

  ${chalk.bold.white('Conversations')}
  ${chalk.cyan('/new')} ${ui.c.dim('[title]')}            New conversation
  ${chalk.cyan('/history')} ${ui.c.dim('/ls')}             List conversations
  ${chalk.cyan('/switch')} ${ui.c.dim('<id>')}              Resume conversation
  ${chalk.cyan('/delete')} ${ui.c.dim('<id>')}              Delete conversation
  ${chalk.cyan('/clear')}                    Clear current messages
  ${chalk.cyan('/messages')} ${ui.c.dim('/m')}             Show message history
  ${chalk.cyan('/compact')}                  Compress old messages to save tokens
  ${chalk.cyan('/tokens')}                   Show context window usage
  ${chalk.cyan('/retry')} ${ui.c.dim('/r')}                Resend last message
  ${chalk.cyan('/fork')}                     Branch into new conversation

  ${chalk.bold.white('Scheduling')}
  ${chalk.cyan('/future')} ${ui.c.dim('<min> <msg>')}      Send message after N minutes
  ${chalk.cyan('/loop')} ${ui.c.dim('<min> <msg>')}        Repeat message every N minutes
  ${chalk.cyan('/loops')}                    List active loops
  ${chalk.cyan('/stop')} ${ui.c.dim('<id|all>')}           Stop a loop or all loops

  ${chalk.bold.white('Context')}
  ${chalk.cyan('/inject')} ${ui.c.dim('<file>')}           Inject file into next message
  ${chalk.cyan('/add')} ${ui.c.dim('<file>')}              Pin file into every message
  ${chalk.cyan('/context')}                  Show pinned files
  ${chalk.cyan('/drop')} ${ui.c.dim('<file|all>')}         Unpin a file

  ${chalk.bold.white('Agent Modes')}
  ${chalk.cyan('/ask')}                     Toggle read-only mode (no writes)
  ${chalk.cyan('/plan')} ${ui.c.dim('<task>')}             Agent plans, you approve, then executes
  ${chalk.cyan('/commit')}                   Auto-generate commit from diff
  ${chalk.cyan('/review')}                   Agent reviews staged changes
  ${chalk.cyan('/test')} ${ui.c.dim('[command]')}          Run tests, auto-fix failures
  ${chalk.cyan('/undo')}                     Revert last file change

  ${chalk.bold.white('Quick Actions')}
  ${chalk.cyan('/run')} ${ui.c.dim('<command>')}           Run shell command (no AI)
  ${chalk.cyan('/diff')}                     Show git diff
  ${chalk.cyan('/status')}                   Show git status
  ${chalk.cyan('/copy')}                     Copy last response to clipboard
  ${chalk.cyan('/export')} ${ui.c.dim('[file]')}           Export conversation to markdown

  ${chalk.bold.white('MCP (External Tools)')}
  ${chalk.cyan('/mcp list')}                  Show connected servers & tools
  ${chalk.cyan('/mcp add')} ${ui.c.dim('<name> <cmd> [args]')}  Add an MCP server
  ${chalk.cyan('/mcp remove')} ${ui.c.dim('<name>')}         Remove an MCP server
  ${chalk.cyan('/mcp restart')} ${ui.c.dim('[name]')}        Reconnect server(s)

  ${chalk.bold.white('Settings')}
  ${chalk.cyan('/config set')} ${ui.c.dim('<k> <v>')}      Set config value
  ${chalk.cyan('/config show')}               Show config
  ${chalk.cyan('/model')} ${ui.c.dim('<name>')}             Switch model
  ${chalk.cyan('/auto')}                     Toggle auto-approve tools
  ${chalk.cyan('/project')} ${ui.c.dim('[path]')}           Show/change project
  ${chalk.cyan('/profile')} ${ui.c.dim('<name>')}           Save/switch model profile
  ${chalk.cyan('/profiles')}                 List saved profiles
  ${chalk.cyan('/setup')}                    Re-run setup wizard

  ${chalk.bold.white('Config Keys')}
  ${ui.c.dim('api_key, api_base_url, model, auto_approve, max_iterations,')}
  ${ui.c.dim('system_prompt, context_limit (override token limit for any model)')}

  ${chalk.cyan('/help')}  ${chalk.cyan('/quit')}
  `);
}

// --- Commands ---
async function handleCommand(input: string) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case '/help': case '/h':
      showHelp();
      break;

    case '/config': case '/c': {
      const sub = parts[1];
      if (sub === 'set' && parts[2] && parts[3]) {
        setConfig(parts[2], parts.slice(3).join(' '));
        const display = parts[2] === 'api_key' ? parts[3].slice(0, 12) + '...' : parts.slice(3).join(' ');
        console.log(`\n  ${ui.icon.check} ${ui.c.accent(parts[2])} ${ui.c.dim('=')} ${display}\n`);
      } else if (sub === 'show') {
        ui.configTable(getAllConfig());
      } else {
        console.log(ui.c.dim('\n  Usage: /config set <key> <value> | /config show\n'));
      }
      break;
    }

    case '/model': {
      const m = parts.slice(1).join(' ');
      if (!m) { console.log(`\n  ${ui.c.dim('Model:')} ${getConfig('model') || 'gpt-4o'}\n`); break; }
      setConfig('model', m);
      console.log(`\n  ${ui.icon.check} Model: ${chalk.white(m)}\n`);
      break;
    }

    case '/auto': {
      const current = getConfig('auto_approve') === 'true';
      setConfig('auto_approve', current ? 'false' : 'true');
      const status = !current ? `${ui.c.success('ON')} ${ui.c.dim('(tools run without asking)')}` : `${ui.c.warn('OFF')} ${ui.c.dim('(will prompt before writes)')}`;
      console.log(`\n  ${ui.icon.check} Auto-approve: ${status}\n`);
      break;
    }

    case '/project': case '/p': {
      const p = parts.slice(1).join(' ');
      if (!p) { console.log(`\n  ${ui.c.dim('Project:')} ${projectRoot}\n`); break; }
      projectRoot = resolve(p);
      console.log(`\n  ${ui.icon.check} Project: ${projectRoot}\n`);
      break;
    }

    case '/setup': {
      await runSetup(rl);
      ui.statusBar(projectRoot, getConfig('model') || 'gpt-4o', getConfig('api_base_url') || 'https://api.openai.com/v1');
      break;
    }

    case '/new': case '/n': {
      const title = parts.slice(1).join(' ') || 'New Chat';
      activeConvo = createConversation(title, projectRoot);
      history = [];
      console.log(`\n  ${ui.icon.check} ${chalk.white(`#${activeConvo.id}`)} ${title}\n`);
      break;
    }

    case '/history': case '/ls': {
      const convos = listConversations().map(c => ({
        ...c,
        msgCount: getMessages(c.id).length,
      }));
      if (convos.length === 0) {
        console.log(ui.c.dim('\n  No conversations yet. Just start typing!\n'));
      } else {
        ui.convoList(convos, activeConvo?.id ?? null);
      }
      break;
    }

    case '/switch': case '/s': {
      const id = parseInt(parts[1]);
      if (isNaN(id)) { console.log(ui.c.dim('\n  Usage: /switch <id>\n')); break; }
      const convo = getConversation(id);
      if (!convo) { console.log(`\n  ${ui.icon.cross} Not found: #${id}\n`); break; }
      activeConvo = convo;
      projectRoot = convo.project_root || process.cwd();
      const msgs = getMessages(id);
      history = msgs.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
        tool_call_id: m.tool_call_id ?? undefined,
      }));
      console.log(`\n  ${ui.icon.check} Switched to ${chalk.white(`#${id}`)} ${convo.title} ${ui.c.dim(`(${msgs.length} msgs)`)}\n`);
      break;
    }

    case '/delete': case '/d': {
      const id = parseInt(parts[1]);
      if (isNaN(id)) { console.log(ui.c.dim('\n  Usage: /delete <id>\n')); break; }
      deleteConversation(id);
      if (activeConvo?.id === id) { activeConvo = null; history = []; }
      console.log(`\n  ${ui.icon.check} Deleted #${id}\n`);
      break;
    }

    case '/clear':
      if (activeConvo) {
        clearMessages(activeConvo.id);
        history = [];
        console.log(`\n  ${ui.icon.check} Conversation cleared.\n`);
      } else {
        console.log(ui.c.dim('\n  No active conversation.\n'));
      }
      break;

    case '/messages': case '/m': {
      if (!activeConvo) { console.log(ui.c.dim('\n  No active conversation.\n')); break; }
      const msgs = getMessages(activeConvo.id);
      console.log();
      for (const m of msgs) {
        const role = m.role === 'user' ? ui.c.accent('you') :
                     m.role === 'assistant' ? ui.c.brand('koda') :
                     ui.c.dim(m.role);
        const content = (m.content || '').slice(0, 120).replace(/\n/g, ' ');
        console.log(`  ${role}  ${content}${(m.content?.length || 0) > 120 ? ui.c.dim('...') : ''}`);
      }
      console.log(ui.c.dim(`\n  ${msgs.length} messages\n`));
      break;
    }

    case '/compact': {
      if (!activeConvo || history.length < 4) {
        console.log(ui.c.dim('\n  Nothing to compact.\n'));
        break;
      }
      const model = getConfig('model') || 'gpt-4o';
      const systemPrompt = getConfig('system_prompt') || '';
      const beforeTokens = estimateMessageTokens(history);
      const { compacted, dropped } = compactHistory(history, systemPrompt, '', model);
      history = compacted;
      const afterTokens = estimateMessageTokens(history);
      const saved = beforeTokens - afterTokens;
      console.log(`\n  ${ui.icon.check} Compacted: dropped ${dropped} messages, saved ~${Math.round(saved / 1000)}k tokens`);
      console.log(`  ${ui.c.dim(`${history.length} messages remaining (~${Math.round(afterTokens / 1000)}k tokens)`)}\n`);
      break;
    }

    case '/tokens': {
      const model = getConfig('model') || 'gpt-4o';
      const limit = getContextLimit(model);
      const historyTokens = estimateMessageTokens(history);
      const pct = Math.round((historyTokens / limit) * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      console.log();
      console.log(`  ${ui.c.accent('Model')}     ${model}`);
      console.log(`  ${ui.c.accent('Limit')}     ${Math.round(limit / 1000)}k tokens`);
      console.log(`  ${ui.c.accent('History')}   ~${Math.round(historyTokens / 1000)}k tokens (${history.length} messages)`);
      console.log(`  ${ui.c.accent('Usage')}     ${pct > 80 ? ui.c.error(bar) : pct > 60 ? ui.c.warn(bar) : ui.c.success(bar)} ${pct}%`);
      if (pct > 80) {
        console.log(`  ${ui.icon.warn} ${ui.c.warn('High usage — consider /compact or /new')}`);
      }
      console.log();
      break;
    }

    case '/retry': case '/r': {
      if (!lastUserMessage) { console.log(ui.c.dim('\n  Nothing to retry.\n')); break; }
      console.log(`\n  ${ui.icon.info} Retrying: ${ui.c.dim(lastUserMessage.slice(0, 60))}...\n`);
      await sendMessage(lastUserMessage);
      break;
    }

    case '/fork': {
      if (!activeConvo) { console.log(ui.c.dim('\n  No conversation to fork.\n')); break; }
      const oldTitle = activeConvo.title || 'Chat';
      const newConvo = createConversation(`Fork of ${oldTitle}`, projectRoot);
      for (const m of history) {
        if (m.role === 'user' || m.role === 'assistant') {
          addMessage(newConvo.id, m.role, m.content);
        }
      }
      activeConvo = newConvo;
      console.log(`\n  ${ui.icon.check} Forked into ${chalk.white(`#${newConvo.id}`)}\n`);
      break;
    }

    case '/future': {
      const mins = parseFloat(parts[1]);
      const msg = parts.slice(2).join(' ');
      if (!mins || !msg) {
        console.log(ui.c.dim('\n  Usage: /future <minutes> <message>\n'));
        break;
      }
      const id = `future-${Date.now()}`;
      const timer = setTimeout(async () => {
        console.log(`\n\n  ${ui.icon.tool} ${ui.c.warn('Scheduled message:')}\n  ${ui.c.dim(msg)}\n`);
        scheduledTimers.delete(id);
        await sendMessage(msg);
        prompt();
      }, mins * 60 * 1000);
      scheduledTimers.set(id, timer);
      const fireTime = new Date(Date.now() + mins * 60 * 1000).toLocaleTimeString();
      console.log(`\n  ${ui.icon.check} Scheduled in ${chalk.white(`${mins}m`)} (at ${ui.c.dim(fireTime)}): ${ui.c.dim(msg)}\n`);
      break;
    }

    case '/loop': {
      const mins = parseFloat(parts[1]);
      const msg = parts.slice(2).join(' ');
      if (!mins || !msg) {
        console.log(ui.c.dim('\n  Usage: /loop <minutes> <message>\n'));
        break;
      }
      const id = `loop-${Date.now()}`;
      const timer = setInterval(async () => {
        console.log(`\n\n  ${ui.icon.tool} ${ui.c.warn(`Loop [${id.slice(-6)}]:`)}\n  ${ui.c.dim(msg)}\n`);
        await sendMessage(msg);
        prompt();
      }, mins * 60 * 1000);
      loopTimers.set(id, { timer, interval: mins, message: msg });
      console.log(`\n  ${ui.icon.check} Loop ${chalk.white(id.slice(-6))} every ${chalk.white(`${mins}m`)}: ${ui.c.dim(msg)}\n`);
      break;
    }

    case '/loops': {
      if (loopTimers.size === 0 && scheduledTimers.size === 0) {
        console.log(ui.c.dim('\n  No active timers.\n'));
        break;
      }
      console.log();
      for (const [id, loop] of loopTimers) {
        console.log(`  ${ui.icon.chat} ${chalk.white(id.slice(-6))} ${ui.c.dim(`every ${loop.interval}m`)} — ${loop.message}`);
      }
      for (const [id] of scheduledTimers) {
        console.log(`  ${ui.icon.thinking} ${chalk.white(id.slice(-6))} ${ui.c.dim('(one-time)')}`);
      }
      console.log();
      break;
    }

    case '/stop': {
      const target = parts[1];
      if (!target) { console.log(ui.c.dim('\n  Usage: /stop <id|all>\n')); break; }
      if (target === 'all') {
        let count = 0;
        for (const [id, loop] of loopTimers) { clearInterval(loop.timer); loopTimers.delete(id); count++; }
        for (const [id, timer] of scheduledTimers) { clearTimeout(timer); scheduledTimers.delete(id); count++; }
        console.log(`\n  ${ui.icon.check} Stopped ${count} timers.\n`);
      } else {
        let found = false;
        for (const [id, loop] of loopTimers) {
          if (id.endsWith(target)) { clearInterval(loop.timer); loopTimers.delete(id); found = true; break; }
        }
        for (const [id, timer] of scheduledTimers) {
          if (id.endsWith(target)) { clearTimeout(timer); scheduledTimers.delete(id); found = true; break; }
        }
        console.log(found ? `\n  ${ui.icon.check} Stopped ${target}\n` : `\n  ${ui.icon.cross} Timer not found: ${target}\n`);
      }
      break;
    }

    case '/undo': {
      const change = popUndo();
      if (!change) { console.log(ui.c.dim('\n  Nothing to undo.\n')); break; }
      const relPath = resolve(change.path).replace(projectRoot + '/', '');
      if (change.previousContent === null) {
        try { unlinkSync(change.path); } catch { /* already gone */ }
        console.log(`\n  ${ui.icon.check} Undo: deleted ${ui.c.file(relPath)} ${ui.c.dim('(was newly created)')}\n`);
      } else {
        writeFileSync(change.path, change.previousContent, 'utf-8');
        console.log(`\n  ${ui.icon.check} Undo: restored ${ui.c.file(relPath)} ${ui.c.dim(`(${change.tool})`)}\n`);
      }
      break;
    }

    case '/inject': {
      const filePath = parts.slice(1).join(' ');
      if (!filePath) { console.log(ui.c.dim('\n  Usage: /inject <file>\n')); break; }
      const fullPath = resolve(projectRoot, filePath);
      try {
        const content = readFileSync(fullPath, 'utf-8');
        pendingInject = `File: ${filePath}\n\`\`\`\n${content}\n\`\`\``;
        console.log(`\n  ${ui.icon.check} Injected ${ui.c.file(filePath)} ${ui.c.dim(`(${content.split('\n').length} lines)`)} — will be included in your next message\n`);
      } catch (e: any) {
        console.log(`\n  ${ui.icon.cross} ${e.message}\n`);
      }
      break;
    }

    case '/add': {
      const filePath = parts.slice(1).join(' ');
      if (!filePath) { console.log(ui.c.dim('\n  Usage: /add <file>\n')); break; }
      const fullPath = resolve(projectRoot, filePath);
      try {
        const content = readFileSync(fullPath, 'utf-8');
        pinnedFiles.set(filePath, content);
        console.log(`\n  ${ui.icon.check} Pinned ${ui.c.file(filePath)} ${ui.c.dim(`(${content.split('\n').length} lines)`)} — included in every message\n`);
      } catch (e: any) {
        console.log(`\n  ${ui.icon.cross} ${e.message}\n`);
      }
      break;
    }

    case '/context': {
      if (pinnedFiles.size === 0) { console.log(ui.c.dim('\n  No pinned files. Use /add <file> to pin.\n')); break; }
      console.log();
      for (const [path, content] of pinnedFiles) {
        console.log(`  ${ui.icon.chat} ${ui.c.file(path)} ${ui.c.dim(`(${content.split('\n').length} lines)`)}`);
      }
      console.log();
      break;
    }

    case '/drop': {
      const target = parts.slice(1).join(' ');
      if (!target) { console.log(ui.c.dim('\n  Usage: /drop <file|all>\n')); break; }
      if (target === 'all') {
        const count = pinnedFiles.size;
        pinnedFiles.clear();
        console.log(`\n  ${ui.icon.check} Dropped ${count} pinned files.\n`);
      } else {
        if (pinnedFiles.delete(target)) {
          console.log(`\n  ${ui.icon.check} Dropped ${ui.c.file(target)}\n`);
        } else {
          console.log(`\n  ${ui.icon.cross} Not pinned: ${target}\n`);
        }
      }
      break;
    }

    case '/ask': {
      readOnlyMode = !readOnlyMode;
      if (readOnlyMode) {
        setConfig('auto_approve', 'false');
      }
      const status = readOnlyMode
        ? `${ui.c.success('ON')} ${ui.c.dim('(agent can only read and search, no writes)')}`
        : `${ui.c.warn('OFF')} ${ui.c.dim('(agent can read + write)')}`;
      console.log(`\n  ${ui.icon.check} Read-only mode: ${status}\n`);
      break;
    }

    case '/plan': {
      const task = parts.slice(1).join(' ');
      if (!task) { console.log(ui.c.dim('\n  Usage: /plan <task description>\n')); break; }
      const planPrompt = `I need you to plan this task step by step. DO NOT execute anything yet. Just output a numbered plan of what you would do, which files you'd read/modify, and what changes you'd make. Be specific.\n\nTask: ${task}`;
      console.log(`\n  ${ui.icon.thinking} ${ui.c.brand('Planning...')} ${ui.c.dim('(agent will describe steps without executing)')}\n`);
      await sendMessage(planPrompt);
      break;
    }

    case '/commit': {
      const commitPrompt = `Look at the current git diff (staged and unstaged changes). Generate a concise, descriptive commit message following conventional commits format. Then stage all changes with git add and commit with that message. Show me the commit message before committing.`;
      console.log(`\n  ${ui.icon.thinking} ${ui.c.brand('Generating commit...')}\n`);
      await sendMessage(commitPrompt);
      break;
    }

    case '/review': {
      const reviewPrompt = `Review the current git diff. Look for: bugs, security issues, logic errors, missing edge cases, code style problems. Be specific about what's wrong and suggest fixes. If everything looks good, say so.`;
      console.log(`\n  ${ui.icon.thinking} ${ui.c.brand('Reviewing changes...')}\n`);
      await sendMessage(reviewPrompt);
      break;
    }

    case '/test': {
      const testCmd = parts.slice(1).join(' ') || 'npm test';
      const testPrompt = `Run the test command: \`${testCmd}\`. If any tests fail, analyze the failures and fix the code. Keep running tests until they pass or you've made 3 attempts.`;
      console.log(`\n  ${ui.icon.thinking} ${ui.c.brand(`Running tests...`)} ${ui.c.dim(`(${testCmd})`)}\n`);
      await sendMessage(testPrompt);
      break;
    }

    case '/profile': {
      const name = parts.slice(1).join(' ');
      if (!name) { console.log(ui.c.dim('\n  Usage: /profile <name>\n  Example: /profile work\n')); break; }
      const key = getConfig(`profile_${name}_key`);
      const url = getConfig(`profile_${name}_url`);
      const model = getConfig(`profile_${name}_model`);
      if (!key && !model) {
        const curKey = getConfig('api_key') || '';
        const curUrl = getConfig('api_base_url') || 'https://api.openai.com/v1';
        const curModel = getConfig('model') || 'gpt-4o';
        setConfig(`profile_${name}_key`, curKey);
        setConfig(`profile_${name}_url`, curUrl);
        setConfig(`profile_${name}_model`, curModel);
        console.log(`\n  ${ui.icon.check} Saved profile ${chalk.white(name)}: ${curModel} @ ${ui.c.dim(curUrl)}\n`);
      } else {
        if (key) setConfig('api_key', key);
        if (url) setConfig('api_base_url', url);
        if (model) setConfig('model', model);
        console.log(`\n  ${ui.icon.check} Switched to profile ${chalk.white(name)}: ${model || 'gpt-4o'} @ ${ui.c.dim(url || 'openai')}\n`);
      }
      break;
    }

    case '/profiles': {
      const cfg = getAllConfig();
      const profiles = new Set<string>();
      for (const k of Object.keys(cfg)) {
        const match = k.match(/^profile_(.+)_model$/);
        if (match) profiles.add(match[1]);
      }
      if (profiles.size === 0) {
        console.log(ui.c.dim('\n  No profiles saved. Use /profile <name> to save current settings as a profile.\n'));
        break;
      }
      console.log();
      for (const name of profiles) {
        const model = cfg[`profile_${name}_model`] || '?';
        const url = cfg[`profile_${name}_url`] || '?';
        console.log(`  ${ui.icon.chat} ${chalk.white(name)}  ${model}  ${ui.c.dim(url)}`);
      }
      console.log();
      break;
    }

    case '/run': case '/!': {
      const command = parts.slice(1).join(' ');
      if (!command) { console.log(ui.c.dim('\n  Usage: /run <command>\n')); break; }
      console.log();
      try {
        const output = execSync(command, { cwd: projectRoot, encoding: 'utf-8', timeout: 30000 });
        console.log(output);
      } catch (e: any) {
        console.log(e.stdout?.toString() || '');
        console.log(ui.c.error(e.stderr?.toString() || e.message));
      }
      break;
    }

    case '/diff': {
      try {
        const diff = execSync('git diff', { cwd: projectRoot, encoding: 'utf-8', timeout: 10000 });
        console.log();
        console.log(diff || ui.c.dim('  No changes.'));
        console.log();
      } catch (e: any) {
        console.log(`\n  ${ui.icon.cross} ${e.message}\n`);
      }
      break;
    }

    case '/status': {
      try {
        const status = execSync('git status --short', { cwd: projectRoot, encoding: 'utf-8', timeout: 10000 });
        console.log();
        console.log(status || ui.c.dim('  Clean working tree.'));
        console.log();
      } catch (e: any) {
        console.log(`\n  ${ui.icon.cross} ${e.message}\n`);
      }
      break;
    }

    case '/copy': {
      if (!lastAgentResponse) { console.log(ui.c.dim('\n  Nothing to copy.\n')); break; }
      try {
        execSync('pbcopy', { input: lastAgentResponse, timeout: 5000 });
        console.log(`\n  ${ui.icon.check} Copied ${lastAgentResponse.length} chars to clipboard.\n`);
      } catch {
        try {
          execSync('xclip -selection clipboard', { input: lastAgentResponse, timeout: 5000 });
          console.log(`\n  ${ui.icon.check} Copied to clipboard.\n`);
        } catch {
          console.log(`\n  ${ui.icon.cross} Clipboard not available.\n`);
        }
      }
      break;
    }

    case '/export': {
      if (!activeConvo) { console.log(ui.c.dim('\n  No active conversation.\n')); break; }
      const msgs = getMessages(activeConvo.id);
      const filename = parts[1] || `koda-chat-${activeConvo.id}.md`;
      const md = [`# ${activeConvo.title}\n`];
      for (const m of msgs) {
        if (m.role === 'user') md.push(`## You\n\n${m.content}\n`);
        else if (m.role === 'assistant') md.push(`## Koda\n\n${m.content}\n`);
      }
      writeFileSync(resolve(projectRoot, filename), md.join('\n'), 'utf-8');
      console.log(`\n  ${ui.icon.check} Exported ${msgs.length} messages to ${ui.c.file(filename)}\n`);
      break;
    }

    case '/mcp': {
      const sub = parts[1];

      if (!sub || sub === 'list') {
        const servers = getConnectedServers();
        const config = loadMcpConfig();
        if (servers.length === 0 && Object.keys(config.mcpServers).length === 0) {
          console.log(ui.c.dim('\n  No MCP servers configured. Use /mcp add <name> <command> [args...]\n'));
        } else {
          console.log(`\n  ${chalk.bold.white('Connected:')}`);
          ui.mcpServerList(servers);
          const configuredNames = Object.keys(config.mcpServers);
          const connectedNames = new Set(servers.map(s => s.name));
          const disconnected = configuredNames.filter(n => !connectedNames.has(n));
          if (disconnected.length > 0) {
            console.log(`  ${chalk.bold.white('Not connected:')}`);
            for (const name of disconnected) {
              const s = config.mcpServers[name];
              console.log(`  ${ui.icon.cross} ${ui.c.dim(name)} ${ui.c.dim([s.command, ...(s.args || [])].join(' '))}`);
            }
            console.log();
          }
        }
        break;
      }

      if (sub === 'add') {
        const name = parts[2];
        const command = parts[3];
        if (!name || !command) {
          console.log(ui.c.dim('\n  Usage: /mcp add <name> <command> [args...]\n'));
          console.log(ui.c.dim('  Example: /mcp add postgres npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb\n'));
          break;
        }
        const args = parts.slice(4);
        addServerConfig(name, command, args);
        console.log(`\n  ${ui.icon.check} Added MCP server ${chalk.white(name)}: ${ui.c.dim([command, ...args].join(' '))}`);

        const config = loadMcpConfig();
        try {
          const tools = await connectServer(name, config.mcpServers[name]);
          console.log(`  ${ui.icon.check} Connected — ${tools.length} tools available\n`);
        } catch (e: any) {
          console.log(`  ${ui.icon.warn} Saved config but failed to connect: ${ui.c.error(e.message)}\n`);
        }
        break;
      }

      if (sub === 'remove') {
        const name = parts[2];
        if (!name) { console.log(ui.c.dim('\n  Usage: /mcp remove <name>\n')); break; }
        await disconnectServer(name);
        const removed = removeServerConfig(name);
        if (removed) {
          console.log(`\n  ${ui.icon.check} Removed MCP server ${chalk.white(name)}\n`);
        } else {
          console.log(`\n  ${ui.icon.cross} Server not found: ${name}\n`);
        }
        break;
      }

      if (sub === 'restart') {
        const name = parts[2];
        if (name) {
          const config = loadMcpConfig();
          const serverConfig = config.mcpServers[name];
          if (!serverConfig) { console.log(`\n  ${ui.icon.cross} Server not configured: ${name}\n`); break; }
          await disconnectServer(name);
          try {
            const tools = await connectServer(name, serverConfig);
            console.log(`\n  ${ui.icon.check} Reconnected ${chalk.white(name)} — ${tools.length} tools\n`);
          } catch (e: any) {
            console.log(`\n  ${ui.icon.cross} Failed: ${e.message}\n`);
          }
        } else {
          console.log(`\n  ${ui.icon.info} Reconnecting all MCP servers...`);
          await disconnectAll();
          const tools = await connectAllServers((n, status, detail) => {
            if (status === 'connected') console.log(`  ${ui.icon.check} ${n} ${ui.c.dim(`(${detail})`)}`);
            else if (status === 'failed') console.log(`  ${ui.icon.cross} ${n} ${ui.c.error(detail || 'failed')}`);
          });
          console.log(`  ${ui.c.dim(`${tools.length} total tools`)}\n`);
        }
        break;
      }

      console.log(ui.c.dim('\n  Usage: /mcp list | add <name> <cmd> [args] | remove <name> | restart [name]\n'));
      break;
    }

    case '/quit': case '/q': case '/exit':
      await disconnectAll();
      for (const [, loop] of loopTimers) clearInterval(loop.timer);
      for (const [, timer] of scheduledTimers) clearTimeout(timer);
      console.log(ui.c.dim('\n  Bye!\n'));
      process.exit(0);

    default:
      console.log(`\n  ${ui.c.dim('Unknown:')} ${cmd} ${ui.c.dim('— type /help')}\n`);
  }
}

// --- Multi-line input ---
let multiLineBuffer: string[] | null = null;

function handleLine(line: string) {
  const trimmed = line.trim();

  if (trimmed === '"""' && !multiLineBuffer) {
    multiLineBuffer = [];
    process.stdout.write(ui.c.dim('  ... '));
    return null;
  }

  if (trimmed === '"""' && multiLineBuffer) {
    const fullMessage = multiLineBuffer.join('\n');
    multiLineBuffer = null;
    return fullMessage.trim() || null;
  }

  if (multiLineBuffer) {
    multiLineBuffer.push(line);
    process.stdout.write(ui.c.dim('  ... '));
    return null;
  }

  return trimmed || null;
}

// --- Line/Close handlers ---
async function lineHandler(line: string) {
  clearSuggestions();
  suggestionIdx = 0;

  const input = handleLine(line);
  if (input === null) {
    if (!multiLineBuffer) prompt();
    return;
  }

  if (input.startsWith('/')) {
    await handleCommand(input);
  } else {
    await sendMessage(input);
  }

  prompt();
}

async function closeHandler() {
  await disconnectAll();
  for (const [, loop] of loopTimers) clearInterval(loop.timer);
  for (const [, timer] of scheduledTimers) clearTimeout(timer);
  console.log(ui.c.dim('\n  Bye!\n'));
  process.exit(0);
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0 && !process.stdin.isTTY) {
    let piped = '';
    for await (const chunk of process.stdin) piped += chunk;
    const message = `${args.join(' ')}\n\n<stdin>\n${piped.trim()}\n</stdin>`;
    const { getConfig: gc } = await import('../db/store.js');
    if (!gc('api_key')) { console.error('No API key. Run: koda, then /config set api_key YOUR_KEY'); process.exit(1); }
    const conv = createConversation('pipe', process.cwd());
    activeConvo = conv;
    await sendMessage(message);
    process.exit(0);
  }

  if (args.length > 0 && process.stdin.isTTY) {
    emitKeypressEvents(process.stdin, rl);
    console.clear();
    ui.logo();
    if (needsSetup()) { await runSetup(rl); }
    ui.statusBar(projectRoot, getConfig('model') || 'gpt-4o', getConfig('api_base_url') || 'https://api.openai.com/v1');
    await connectAllServers();
    activeConvo = createConversation(args.join(' ').slice(0, 50), projectRoot);
    await sendMessage(args.join(' '));
    prompt();
    rl.on('line', lineHandler);
    rl.on('close', closeHandler);
    return;
  }

  emitKeypressEvents(process.stdin, rl);

  console.clear();
  ui.logo();

  if (needsSetup()) {
    await runSetup(rl);
  }

  ui.statusBar(
    projectRoot,
    getConfig('model') || 'gpt-4o',
    getConfig('api_base_url') || 'https://api.openai.com/v1',
  );

  const mcpConfig = loadMcpConfig();
  const mcpNames = Object.keys(mcpConfig.mcpServers);
  if (mcpNames.length > 0) {
    const mcpTools = await connectAllServers((name, status, detail) => {
      if (status === 'connecting') process.stdout.write(ui.c.dim(`  MCP: connecting ${name}...`));
      else if (status === 'connected') process.stdout.write(` ${ui.icon.check} ${ui.c.dim(detail || '')}\n`);
      else if (status === 'failed') process.stdout.write(` ${ui.icon.cross} ${ui.c.error(detail || 'failed')}\n`);
    });
    if (mcpTools.length > 0) {
      console.log(ui.c.dim(`  ${getMcpServerCount()} MCP server(s), ${mcpTools.length} tools ready\n`));
    }
  }

  const convos = listConversations();
  const lastForProject = convos.find(c => c.project_root === projectRoot);
  if (lastForProject) {
    activeConvo = lastForProject;
    const msgs = getMessages(lastForProject.id);
    history = msgs.map(m => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      tool_call_id: m.tool_call_id ?? undefined,
    }));
    if (msgs.length > 0) {
      console.log(ui.c.dim(`  Resumed #${lastForProject.id}: ${lastForProject.title} (${msgs.length} msgs)`));
      console.log(ui.c.dim(`  /new for a fresh conversation\n`));
    }
  }

  if (!activeConvo) {
    activeConvo = createConversation('New Chat', projectRoot);
  }

  prompt();
  rl.on('line', lineHandler);
  rl.on('close', closeHandler);
}

main();
