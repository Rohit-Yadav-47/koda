/**
 * Context window management — token estimation, auto-compaction, and truncation.
 *
 * Uses a ~4 chars/token heuristic (accurate enough for gpt-4o / claude / llama).
 * No external tokenizer dependency needed.
 */

import OpenAI from 'openai';
import { getConfig } from '../db/store.js';

// --- Known context window sizes (input tokens) ---
const MODEL_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-4o':            128_000,
  'gpt-4o-mini':       128_000,
  'gpt-4-turbo':       128_000,
  'gpt-4':               8_192,
  'gpt-3.5-turbo':      16_385,
  'o1':                200_000,
  'o1-mini':           128_000,
  'o1-pro':            200_000,
  'o3':                200_000,
  'o3-mini':           200_000,
  'o4-mini':           200_000,
  // Anthropic (via OpenAI-compat)
  'claude-sonnet-4-20250514':  200_000,
  'claude-opus-4-20250514':    200_000,
  'claude-haiku-3-5':  200_000,
  'claude':            200_000,
  // Llama / Groq
  'llama-3.3-70b-versatile': 128_000,
  'llama3':              8_192,
  // Gemini
  'gemini':          1_000_000,
  // Mistral
  'mistral-large':     128_000,
  'mistral':            32_000,
  // DeepSeek
  'deepseek':          128_000,
  // Default — most modern models support at least 200k
  'default':           200_000,
};

/**
 * Get context limit for a model.
 * Priority: user override (/config set context_limit) → known model → 200k default.
 */
export function getContextLimit(model: string): number {
  // 1. User override — always wins
  const userLimit = getConfig('context_limit');
  if (userLimit) {
    const parsed = parseInt(userLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 2. Exact match
  if (MODEL_LIMITS[model]) return MODEL_LIMITS[model];

  // 3. Partial match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (key !== 'default' && model.startsWith(key)) return limit;
  }

  return MODEL_LIMITS['default'];
}

// --- Token estimation ---

/** Rough token count: ~4 chars per token, +4 per message overhead */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 4; // message overhead only
  return Math.ceil(text.length / 4) + 4;
}

export function estimateMessageTokens(messages: { role: string; content?: string | null; tool_calls?: any[] }[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content);
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function?.arguments);
        total += estimateTokens(tc.function?.name);
        total += 10; // tool call overhead
      }
    }
  }
  return total;
}

// --- Tool result truncation ---

const TOOL_RESULT_LIMIT = 12_000; // chars (~3k tokens)

export function truncateToolResult(result: string): string {
  if (result.length <= TOOL_RESULT_LIMIT) return result;
  const half = Math.floor(TOOL_RESULT_LIMIT / 2);
  const lines = result.split('\n');
  const totalLines = lines.length;
  return (
    result.slice(0, half) +
    `\n\n... [truncated ${totalLines} lines, ${result.length} chars → showing first/last ${half} chars] ...\n\n` +
    result.slice(-half)
  );
}

// --- History compaction ---

/**
 * Compact history to fit within token budget.
 *
 * Strategy (applied in order until within budget):
 * 1. Truncate large tool results (>3k tokens) to first/last sections
 * 2. Drop tool call/result pairs from oldest conversations (keep the assistant text)
 * 3. Summarize oldest user/assistant exchanges into a single system message
 * 4. Keep at minimum the last 4 messages untouched
 */
export function compactHistory(
  history: AgentMessage[],
  systemPrompt: string,
  newUserMessage: string,
  model: string,
): { compacted: AgentMessage[]; dropped: number } {
  const contextLimit = getContextLimit(model);
  // Reserve 25% for model output + tool schemas overhead
  const inputBudget = Math.floor(contextLimit * 0.75);
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(newUserMessage);
  const fixedTokens = systemTokens + userTokens;

  let working = [...history];
  let dropped = 0;

  // Check if we're already fine
  if (fixedTokens + estimateMessageTokens(working) <= inputBudget) {
    return { compacted: working, dropped: 0 };
  }

  // Phase 1: Truncate large tool results
  working = working.map(msg => {
    if (msg.role === 'tool' && msg.content && msg.content.length > TOOL_RESULT_LIMIT) {
      return { ...msg, content: truncateToolResult(msg.content) };
    }
    return msg;
  });

  if (fixedTokens + estimateMessageTokens(working) <= inputBudget) {
    return { compacted: working, dropped };
  }

  // Phase 2: Drop old tool call/result pairs (keep assistant text responses)
  // Find tool_call messages and their corresponding tool result messages
  const KEEP_RECENT = 6; // keep the last N messages untouched
  const safeZone = working.length - KEEP_RECENT;

  if (safeZone > 0) {
    const compacted: AgentMessage[] = [];
    for (let i = 0; i < working.length; i++) {
      const msg = working[i];

      if (i < safeZone) {
        // In the droppable zone
        if (msg.role === 'tool') {
          // Drop tool results from old messages
          dropped++;
          continue;
        }
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          // Keep assistant text but strip tool_calls
          if (msg.content) {
            compacted.push({ role: 'assistant', content: msg.content });
          }
          dropped++;
          continue;
        }
      }

      compacted.push(msg);
    }
    working = compacted;
  }

  if (fixedTokens + estimateMessageTokens(working) <= inputBudget) {
    return { compacted: working, dropped };
  }

  // Phase 3: Aggressive — summarize old exchanges into a single message
  const keepCount = Math.min(4, working.length);
  const toSummarize = working.slice(0, working.length - keepCount);
  const kept = working.slice(-keepCount);

  if (toSummarize.length > 0) {
    const summary = toSummarize
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => `${m.role}: ${m.content!.slice(0, 200)}`)
      .join('\n');

    const summaryMsg: AgentMessage = {
      role: 'system' as const,
      content: `[Earlier conversation summary — ${toSummarize.length} messages compacted]\n${summary.slice(0, 2000)}`,
    };

    dropped += toSummarize.length;
    working = [summaryMsg, ...kept];
  }

  return { compacted: working, dropped };
}

// --- History summarization ---

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

const SUMMARIZE_PROMPT = `You are a precise assistant that summarizes conversation history into a concise narrative.
Your task:
1. Identify what the user was trying to accomplish
2. Note key decisions, file changes, or outcomes
3. Capture the current state/context
4. Keep the summary to 2-3 sentences max

Rules:
- Write in third person about "the user" and "Koda"
- Include specific file names, commands, or error messages if relevant
- Do NOT include filler phrases like "in the conversation" or "during this session"
- Be concrete: "User was building X, created file Y, resolved error Z by doing W"
- Maximum 500 characters in your response

Here is the conversation to summarize:
{history}

Summary:`;

/**
 * Generate a semantic summary of old conversation history using the LLM.
 * Returns a short narrative summary (2-3 sentences, max ~500 chars).
 */
export async function summarizeHistory(
  history: AgentMessage[],
  apiKey: string,
  baseURL: string,
  model: string,
): Promise<string> {
  const conversationText = history
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  if (!conversationText.trim()) {
    return '[Earlier conversation — no content to summarize]';
  }

  const client = new OpenAI({ apiKey, baseURL });
  const prompt = SUMMARIZE_PROMPT.replace('{history}', conversationText.slice(0, 8000));

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    return summary || '[Earlier conversation summarized]';
  } catch (e) {
    return '[Earlier conversation — could not generate summary]';
  }
}

/**
 * Check if an error is a context length overflow.
 */
export function isContextOverflowError(error: any): boolean {
  const msg = error?.message?.toLowerCase() || '';
  return (
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('token limit') ||
    msg.includes('too many tokens') ||
    msg.includes('context_length_exceeded') ||
    (error?.code === 'context_length_exceeded') ||
    (error?.status === 400 && msg.includes('token'))
  );
}
