import { describe, it, expect } from 'vitest';
import { renderMarkdown, getPrompt, agentHeader, statsLine } from '../src/ui/index.js';

describe('renderMarkdown', () => {
  it('renders plain text', () => {
    const result = renderMarkdown('hello world');
    expect(result).toContain('hello world');
  });

  it('renders bold text', () => {
    const result = renderMarkdown('**bold**');
    expect(result).toContain('bold');
  });

  it('handles empty string', () => {
    const result = renderMarkdown('');
    expect(typeof result).toBe('string');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('const x');
  });
});

describe('getPrompt', () => {
  it('includes conversation id when provided', () => {
    const result = getPrompt(5);
    expect(result).toContain('#5');
    expect(result).toContain('you');
  });

  it('works without conversation id', () => {
    const result = getPrompt(null);
    expect(result).toContain('you');
    expect(result).not.toContain('#');
  });
});

describe('agentHeader', () => {
  it('contains koda', () => {
    const result = agentHeader();
    expect(result).toContain('koda');
  });
});

describe('statsLine', () => {
  it('shows tool count and time', () => {
    const result = statsLine(3, 2500);
    expect(result).toContain('3 tool calls');
    expect(result).toContain('2.5s');
  });

  it('shows only time when no tools', () => {
    const result = statsLine(0, 1000);
    expect(result).not.toContain('tool calls');
    expect(result).toContain('1.0s');
  });
});
