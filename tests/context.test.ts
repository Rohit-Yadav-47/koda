import { describe, it, expect, beforeEach } from 'vitest';
import {
  getContextLimit,
  estimateTokens,
  estimateMessageTokens,
  truncateToolResult,
  compactHistory,
  isContextOverflowError,
} from '../src/core/context.js';
import { setConfig } from '../src/db/store.js';

// Clean up any leftover config before each test
beforeEach(() => {
  try { setConfig('context_limit', ''); } catch {}
});

// --- getContextLimit ---

describe('getContextLimit', () => {
  it('returns exact match for known models', () => {
    expect(getContextLimit('gpt-4o')).toBe(128_000);
    expect(getContextLimit('gpt-4')).toBe(8_192);
    expect(getContextLimit('o3')).toBe(200_000);
  });

  it('returns limit for claude models', () => {
    expect(getContextLimit('claude-sonnet-4-20250514')).toBe(200_000);
    expect(getContextLimit('claude-opus-4-20250514')).toBe(200_000);
  });

  it('matches partial model names', () => {
    expect(getContextLimit('gpt-4o-2024-08-06')).toBe(128_000);
    expect(getContextLimit('claude-anything')).toBe(200_000);
    expect(getContextLimit('deepseek-coder-v2')).toBe(128_000);
    expect(getContextLimit('gemini-pro')).toBe(1_000_000);
  });

  it('returns 200k default for unknown models', () => {
    expect(getContextLimit('some-unknown-model')).toBe(200_000);
  });

  it('user override takes priority over everything', () => {
    setConfig('context_limit', '50000');
    expect(getContextLimit('gpt-4o')).toBe(50_000);
    expect(getContextLimit('unknown-model')).toBe(50_000);
  });

  it('ignores invalid user override', () => {
    setConfig('context_limit', 'not-a-number');
    expect(getContextLimit('gpt-4o')).toBe(128_000);
  });

  it('ignores zero or negative user override', () => {
    setConfig('context_limit', '0');
    expect(getContextLimit('gpt-4o')).toBe(128_000);
    setConfig('context_limit', '-100');
    expect(getContextLimit('gpt-4o')).toBe(128_000);
  });

  it('handles empty string override', () => {
    setConfig('context_limit', '');
    expect(getContextLimit('gpt-4o')).toBe(128_000);
  });
});

// --- estimateTokens ---

describe('estimateTokens', () => {
  it('returns overhead for null/undefined', () => {
    expect(estimateTokens(null)).toBe(4);
    expect(estimateTokens(undefined)).toBe(4);
  });

  it('returns overhead for empty string', () => {
    // '' has length 0, ceil(0/4) + 4 = 4
    expect(estimateTokens('')).toBe(4);
  });

  it('estimates short text', () => {
    // 'hello' = 5 chars → ceil(5/4) + 4 = 2 + 4 = 6
    expect(estimateTokens('hello')).toBe(6);
  });

  it('estimates longer text', () => {
    const text = 'a'.repeat(400);
    // 400 chars → ceil(400/4) + 4 = 100 + 4 = 104
    expect(estimateTokens(text)).toBe(104);
  });

  it('scales linearly', () => {
    const small = estimateTokens('a'.repeat(100));
    const large = estimateTokens('a'.repeat(1000));
    expect(large).toBeGreaterThan(small * 5);
  });
});

// --- estimateMessageTokens ---

describe('estimateMessageTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it('counts single message', () => {
    const tokens = estimateMessageTokens([{ role: 'user', content: 'hello world' }]);
    expect(tokens).toBeGreaterThan(0);
  });

  it('counts multiple messages', () => {
    const one = estimateMessageTokens([{ role: 'user', content: 'hi' }]);
    const three = estimateMessageTokens([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' },
    ]);
    expect(three).toBeGreaterThan(one);
  });

  it('counts tool_calls arguments', () => {
    const withoutTools = estimateMessageTokens([
      { role: 'assistant', content: 'thinking' },
    ]);
    const withTools = estimateMessageTokens([
      {
        role: 'assistant',
        content: 'thinking',
        tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"big-file.ts"}' } }],
      },
    ]);
    expect(withTools).toBeGreaterThan(withoutTools);
  });

  it('handles messages with null content', () => {
    const tokens = estimateMessageTokens([{ role: 'assistant', content: null }]);
    expect(tokens).toBe(4); // just overhead
  });
});

// --- truncateToolResult ---

describe('truncateToolResult', () => {
  it('leaves short results unchanged', () => {
    expect(truncateToolResult('hello')).toBe('hello');
  });

  it('leaves results at exactly the limit unchanged', () => {
    const text = 'a'.repeat(12_000);
    expect(truncateToolResult(text)).toBe(text);
  });

  it('truncates results over the limit', () => {
    const text = 'a'.repeat(20_000);
    const result = truncateToolResult(text);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('truncated');
  });

  it('preserves start and end of content', () => {
    const start = 'START_MARKER' + 'x'.repeat(10_000);
    const end = 'y'.repeat(10_000) + 'END_MARKER';
    const text = start + end;
    const result = truncateToolResult(text);
    expect(result).toContain('START_MARKER');
    expect(result).toContain('END_MARKER');
  });

  it('includes metadata in truncation marker', () => {
    const text = 'line1\nline2\n' + 'x'.repeat(20_000);
    const result = truncateToolResult(text);
    expect(result).toContain('lines');
    expect(result).toContain('chars');
  });
});

// --- compactHistory ---

describe('compactHistory', () => {
  const smallModel = 'gpt-4'; // 8192 tokens

  function makeMessages(count: number, contentSize = 100): any[] {
    const msgs: any[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(contentSize) });
    }
    return msgs;
  }

  it('returns history unchanged when within budget', () => {
    const history = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' },
    ];
    const { compacted, dropped } = compactHistory(history, 'system', 'new message', 'gpt-4o');
    expect(dropped).toBe(0);
    expect(compacted).toEqual(history);
  });

  it('truncates large tool results in phase 1', () => {
    const bigToolResult = 'x'.repeat(50_000);
    const history = [
      { role: 'user' as const, content: 'read this' },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool' as const, content: bigToolResult, tool_call_id: 't1' },
      { role: 'assistant' as const, content: 'done' },
    ];
    const { compacted } = compactHistory(history, 'system', 'next', smallModel);
    const toolMsg = compacted.find(m => m.role === 'tool');
    if (toolMsg?.content) {
      expect(toolMsg.content.length).toBeLessThan(bigToolResult.length);
    }
  });

  it('drops old tool results in phase 2', () => {
    // Create history that exceeds budget: lots of tool results
    const history: any[] = [];
    for (let i = 0; i < 20; i++) {
      history.push({ role: 'user' as const, content: 'do something ' + i });
      history.push({
        role: 'assistant' as const,
        content: null,
        tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'read_file', arguments: `{"path":"f${i}"}` } }],
      });
      history.push({ role: 'tool' as const, content: 'x'.repeat(2000), tool_call_id: `t${i}` });
      history.push({ role: 'assistant' as const, content: 'result ' + i });
    }
    const { compacted, dropped } = compactHistory(history, 'system prompt', 'new msg', smallModel);
    expect(dropped).toBeGreaterThan(0);
    expect(compacted.length).toBeLessThan(history.length);
  });

  it('keeps at least the last few messages', () => {
    const history = makeMessages(50, 500);
    const { compacted } = compactHistory(history, 'system', 'new', smallModel);
    // Should always keep some recent messages
    expect(compacted.length).toBeGreaterThanOrEqual(4);
  });

  it('phase 3 summarizes when still over budget', () => {
    // Create massive history that needs full summarization
    const history = makeMessages(100, 2000);
    const { compacted, dropped } = compactHistory(history, 'system', 'new msg', smallModel);
    expect(dropped).toBeGreaterThan(0);
    // Should have a summary system message
    const summaryMsg = compacted.find(m => m.role === 'system' && m.content?.includes('compacted'));
    expect(summaryMsg).toBeDefined();
  });

  it('does not drop anything for large context window', () => {
    const history = makeMessages(10, 100);
    const { compacted, dropped } = compactHistory(history, 'system', 'msg', 'gemini'); // 1M context
    expect(dropped).toBe(0);
    expect(compacted.length).toBe(history.length);
  });
});

// --- isContextOverflowError ---

describe('isContextOverflowError', () => {
  it('detects context_length_exceeded message', () => {
    expect(isContextOverflowError({ message: 'context_length_exceeded' })).toBe(true);
  });

  it('detects "maximum context" in message', () => {
    expect(isContextOverflowError({ message: 'This request exceeds the maximum context length' })).toBe(true);
  });

  it('detects "too many tokens"', () => {
    expect(isContextOverflowError({ message: 'Too many tokens in the request' })).toBe(true);
  });

  it('detects error code', () => {
    expect(isContextOverflowError({ code: 'context_length_exceeded', message: '' })).toBe(true);
  });

  it('detects 400 status with token mention', () => {
    expect(isContextOverflowError({ status: 400, message: 'token limit exceeded' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isContextOverflowError({ message: 'network error' })).toBe(false);
    expect(isContextOverflowError({ message: 'invalid api key' })).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
  });

  it('returns false for 400 without token mention', () => {
    expect(isContextOverflowError({ status: 400, message: 'bad request' })).toBe(false);
  });
});
