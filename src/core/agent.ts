import OpenAI from 'openai';
import ora from 'ora';
import { toolSchemas, executeTool, WRITE_TOOLS } from '../tools/index.js';
import { getConfig } from '../db/store.js';
import * as ui from '../ui/index.js';
import { generateEditDiff, generateWriteDiff } from './diff.js';
import {
  getAllMcpTools, mcpToolsToOpenAI, isMcpTool, resolveMcpTool, callMcpTool,
} from '../mcp/client.js';
import {
  compactHistory, truncateToolResult, isContextOverflowError,
  estimateMessageTokens, getContextLimit, estimateTokens,
} from './context.js';

const DEFAULT_SYSTEM_PROMPT = `You are Koda, a powerful AI coding agent running in the terminal.

You have these tools:
- read_file: Read file contents with line numbers
- write_file: Create or overwrite files
- edit_file: Find and replace exact strings in files
- run_terminal: Execute shell commands
- search_code: Regex search across project files
- glob_files: Find files by glob pattern
- git_ops: Git operations (status, diff, log, add, commit, branch, checkout)

Guidelines:
- Always read a file before editing it
- Use search_code to find things before making assumptions
- Be precise with edit_file — old_string must match exactly and be unique
- Think step by step for complex tasks
- Keep responses concise
- When writing code, match the existing style and patterns`;

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// --- Permission with diff preview ---

function showWriteDiff(toolName: string, args: any, projectRoot: string) {
  if (toolName === 'edit_file' && args.path && args.old_string != null && args.new_string != null) {
    console.log();
    console.log(generateEditDiff(args.path, args.old_string, args.new_string, projectRoot));
  } else if (toolName === 'write_file' && args.path && args.content != null) {
    console.log();
    console.log(generateWriteDiff(args.path, args.content, projectRoot));
  }
}

const READ_ONLY_TOOLS = new Set(['read_file', 'search_code', 'glob_files']);

export async function runAgent(
  userMessage: string,
  projectRoot: string,
  history: AgentMessage[],
  onToken: (token: string) => void,
  readOnly: boolean = false,
  onStatus?: (status: string) => void,
  abortSignal?: AbortSignal,
): Promise<{ content: string; messages: AgentMessage[] }> {
  const apiKey = getConfig('api_key');
  const baseURL = getConfig('api_base_url') || 'https://api.openai.com/v1';
  const model = getConfig('model') || 'gpt-4o';
  const maxIterations = parseInt(getConfig('max_iterations') || '25');
  const systemPrompt = getConfig('system_prompt') || DEFAULT_SYSTEM_PROMPT;

  if (!apiKey) {
    throw new Error('No API key. Set one with: /config set api_key YOUR_KEY');
  }

  const client = new OpenAI({ apiKey, baseURL });

  // Build system prompt with MCP tool info
  const mcpTools = getAllMcpTools();
  let fullSystemPrompt = systemPrompt;
  if (mcpTools.length > 0) {
    const mcpSection = mcpTools.map(t => `- ${t.name}: ${t.description} [MCP: ${t.serverName}]`).join('\n');
    fullSystemPrompt += `\n\nYou also have access to MCP (external) tools:\n${mcpSection}`;
  }

  // --- Auto-compact history before sending ---
  const { compacted, dropped } = compactHistory(history, fullSystemPrompt, userMessage, model);
  if (dropped > 0) {
    console.log(`  ${ui.icon.info} ${ui.c.dim(`Auto-compacted ${dropped} old messages to fit context window`)}`);
  }

  const messages: AgentMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    ...compacted,
    { role: 'user', content: userMessage },
  ];

  // Merge built-in tools with MCP tools
  const activeTools = readOnly
    ? toolSchemas.filter((t: any) => READ_ONLY_TOOLS.has(t.function.name))
    : [...toolSchemas, ...mcpToolsToOpenAI()];

  // Log context usage
  const totalTokens = estimateMessageTokens(messages);
  const limit = getContextLimit(model);
  const pct = Math.round((totalTokens / limit) * 100);
  if (pct > 60) {
    console.log(`  ${ui.icon.warn} ${ui.c.dim(`Context: ~${Math.round(totalTokens / 1000)}k / ${Math.round(limit / 1000)}k tokens (${pct}%)`)}`);
  }

  let finalContent = '';
  let totalToolCalls = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (abortSignal?.aborted) break;
    onStatus?.(iter === 0 ? 'calling' : 'calling_again');
    let stream;
    try {
      stream = await client.chat.completions.create(
        {
          model,
          messages: messages as any,
          tools: activeTools.length > 0 ? activeTools as any : undefined,
          stream: true,
        },
        { signal: abortSignal },
      );
    } catch (e: any) {
      // If context overflow, do aggressive compaction and retry once
      if (isContextOverflowError(e) && messages.length > 3) {
        console.log(`  ${ui.icon.warn} ${ui.c.warn('Context overflow — compacting and retrying...')}`);
        // Keep only system + last 4 messages + new user message
        const keep = messages.slice(-5);
        messages.length = 0;
        messages.push(
          { role: 'system', content: fullSystemPrompt },
          { role: 'system', content: '[Earlier conversation was truncated due to context limits]' },
          ...keep.filter(m => m.role !== 'system'),
        );
        stream = await client.chat.completions.create(
          {
            model,
            messages: messages as any,
            tools: activeTools.length > 0 ? activeTools as any : undefined,
            stream: true,
          },
          { signal: abortSignal },
        );
      } else {
        throw e;
      }
    }

    let content = '';
    const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
    let firstTokenReceived = false;

    for await (const chunk of stream) {
      if (abortSignal?.aborted) break;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (!firstTokenReceived && (delta.content || delta.tool_calls)) {
        firstTokenReceived = true;
        onStatus?.('responding');
      }

      if (delta.content) {
        content += delta.content;
        onToken(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (existing) {
            existing.args += tc.function?.arguments || '';
          } else {
            toolCalls.set(tc.index, {
              id: tc.id || '',
              name: tc.function?.name || '',
              args: tc.function?.arguments || '',
            });
          }
        }
      }
    }

    // No tool calls — final answer
    if (toolCalls.size === 0) {
      messages.push({ role: 'assistant', content });
      finalContent = content;
      break;
    }

    if (abortSignal?.aborted) {
      messages.push({ role: 'assistant', content: content || null });
      finalContent = content || '';
      break;
    }

    // Build assistant message
    const assistantMsg: AgentMessage = { role: 'assistant', content: content || null, tool_calls: [] };
    for (const [, tc] of toolCalls) {
      assistantMsg.tool_calls!.push({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      });
    }
    messages.push(assistantMsg);

    if (content) onToken('\n');

    // --- Phase 1: Parse args & collect permissions (sequential for interactive prompts) ---
    interface ParsedTool {
      id: string;
      name: string;
      args: any;
      approved: boolean;
      isMcp: boolean;
    }

    const parsed: ParsedTool[] = [];

    for (const [, tc] of toolCalls) {
      totalToolCalls++;
      let args: any;
      try {
        args = JSON.parse(tc.args);
      } catch {
        messages.push({ role: 'tool', content: 'Error: invalid JSON arguments', tool_call_id: tc.id });
        console.log(`\n${ui.toolFail(tc.name, 'invalid JSON args')}`);
        continue;
      }

      const mcpTool = isMcpTool(tc.name);

      if (WRITE_TOOLS.has(tc.name)) {
        showWriteDiff(tc.name, args, projectRoot);
      }

      parsed.push({
        id: tc.id,
        name: tc.name,
        args,
        approved: true,
        isMcp: !!mcpTool,
      });
    }

    const approved = parsed.filter(t => t.approved);

    // --- Phase 2: Execute approved tools in parallel ---
    if (approved.length === 0) {
      onToken('\n');
      continue;
    }

    if (approved.length === 1) {
      // Single tool — use spinner
      const tc = approved[0];
      const argsStr = tc.name === 'write_file'
        ? `${tc.args.path} (${tc.args.content?.length || 0}b)`
        : JSON.stringify(tc.args).slice(0, 70);

      const spinner = ora({
        text: ui.toolStart(tc.name, argsStr).replace(/^  /, ''),
        indent: 2,
        spinner: 'dots',
      }).start();

      try {
        let result: string;
        if (tc.isMcp) {
          const resolved = resolveMcpTool(tc.name)!;
          result = await callMcpTool(resolved.serverName, resolved.toolName, tc.args);
        } else {
          result = await executeTool(tc.name, tc.args, projectRoot);
        }

        spinner.stopAndPersist({ symbol: `  ${ui.icon.check}`, text: `${ui.c.tool(tc.name)} ${ui.c.dim(argsStr)}` });

        if (['read_file', 'search_code', 'glob_files', 'git_ops'].includes(tc.name) || tc.isMcp) {
          console.log(ui.toolPreview(result));
        }

        messages.push({ role: 'tool', content: truncateToolResult(result), tool_call_id: tc.id });
      } catch (e: any) {
        spinner.stopAndPersist({ symbol: `  ${ui.icon.cross}`, text: `${ui.c.tool(tc.name)} ${ui.c.error(e.message)}` });
        messages.push({ role: 'tool', content: `Error: ${e.message}`, tool_call_id: tc.id });
      }
    } else {
      // Multiple tools — parallel execution
      const spinner = ora({
        text: `Running ${approved.length} tools in parallel...`,
        indent: 2,
        spinner: 'dots',
      }).start();

      const results = await Promise.allSettled(
        approved.map(async (tc) => {
          if (tc.isMcp) {
            const resolved = resolveMcpTool(tc.name)!;
            return await callMcpTool(resolved.serverName, resolved.toolName, tc.args);
          }
          return await executeTool(tc.name, tc.args, projectRoot);
        }),
      );

      spinner.stop();

      // Display results
      for (let i = 0; i < approved.length; i++) {
        const tc = approved[i];
        const result = results[i];

        const argsStr = tc.name === 'write_file'
          ? `${tc.args.path} (${tc.args.content?.length || 0}b)`
          : JSON.stringify(tc.args).slice(0, 70);

        if (result.status === 'fulfilled') {
          console.log(`  ${ui.icon.check} ${ui.c.tool(tc.name)} ${ui.c.dim(argsStr)}`);

          if (['read_file', 'search_code', 'glob_files', 'git_ops'].includes(tc.name) || tc.isMcp) {
            console.log(ui.toolPreview(result.value));
          }

          messages.push({ role: 'tool', content: truncateToolResult(result.value), tool_call_id: tc.id });
        } else {
          const errMsg = result.reason?.message || 'Unknown error';
          console.log(`  ${ui.icon.cross} ${ui.c.tool(tc.name)} ${ui.c.error(errMsg)}`);
          messages.push({ role: 'tool', content: `Error: ${errMsg}`, tool_call_id: tc.id });
        }
      }
    }

    onToken('\n');
  }

  return { content: finalContent, messages: messages.slice(1) };
}
