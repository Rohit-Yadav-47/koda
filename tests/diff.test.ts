import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { generateEditDiff, generateWriteDiff } from '../src/core/diff.js';

const TEST_ROOT = join(process.cwd(), '.test-diff');

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  writeFileSync(join(TEST_ROOT, 'sample.ts'), [
    'import { foo } from "./bar";',
    '',
    'const x = 1;',
    'const y = 2;',
    'const z = 3;',
    '',
    'export function add(a: number, b: number) {',
    '  return a + b;',
    '}',
    '',
    'export default { x, y, z };',
  ].join('\n'));
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// --- generateEditDiff ---

describe('generateEditDiff', () => {
  it('shows removed and added lines', () => {
    const diff = generateEditDiff('sample.ts', 'const x = 1;', 'const x = 42;', TEST_ROOT);
    expect(diff).toContain('- const x = 1;');
    expect(diff).toContain('+ const x = 42;');
  });

  it('shows the file name', () => {
    const diff = generateEditDiff('sample.ts', 'const x = 1;', 'const x = 2;', TEST_ROOT);
    expect(diff).toContain('sample.ts');
  });

  it('shows context lines around the change', () => {
    const diff = generateEditDiff('sample.ts', 'const y = 2;', 'const y = 99;', TEST_ROOT);
    // const x = 1 is a context line before
    expect(diff).toContain('const x = 1;');
    // const z = 3 is a context line after
    expect(diff).toContain('const z = 3;');
  });

  it('handles multi-line replacements', () => {
    const oldStr = 'const x = 1;\nconst y = 2;';
    const newStr = 'const x = 10;\nconst y = 20;\nconst w = 30;';
    const diff = generateEditDiff('sample.ts', oldStr, newStr, TEST_ROOT);
    expect(diff).toContain('- const x = 1;');
    expect(diff).toContain('- const y = 2;');
    expect(diff).toContain('+ const x = 10;');
    expect(diff).toContain('+ const y = 20;');
    expect(diff).toContain('+ const w = 30;');
  });

  it('reports when old_string is not found', () => {
    const diff = generateEditDiff('sample.ts', 'nonexistent string', 'replacement', TEST_ROOT);
    expect(diff).toContain('not found');
  });

  it('reports when file does not exist', () => {
    const diff = generateEditDiff('nope.ts', 'anything', 'anything', TEST_ROOT);
    expect(diff).toContain('not found');
  });

  it('handles relative paths', () => {
    const diff = generateEditDiff('sample.ts', 'const x = 1;', 'const x = 2;', TEST_ROOT);
    expect(diff).toContain('sample.ts');
    // Should not contain the full absolute path
    expect(diff).not.toContain(TEST_ROOT);
  });
});

// --- generateWriteDiff ---

describe('generateWriteDiff', () => {
  it('shows new file indicator for non-existent files', () => {
    const diff = generateWriteDiff('brand-new.ts', 'const a = 1;\nconst b = 2;\n', TEST_ROOT);
    expect(diff).toContain('new file');
    expect(diff).toContain('+ const a = 1;');
    expect(diff).toContain('+ const b = 2;');
  });

  it('shows file name', () => {
    const diff = generateWriteDiff('brand-new.ts', 'hello', TEST_ROOT);
    expect(diff).toContain('brand-new.ts');
  });

  it('shows line count change for existing files', () => {
    const diff = generateWriteDiff('sample.ts', 'completely\nnew\ncontent\n', TEST_ROOT);
    // Original has 11 lines, new has 4
    expect(diff).toContain('→');
  });

  it('shows additions and removals for existing files', () => {
    // Change one line
    const newContent = [
      'import { foo } from "./bar";',
      '',
      'const x = 999;',  // changed
      'const y = 2;',
      'const z = 3;',
      '',
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      '',
      'export default { x, y, z };',
    ].join('\n');
    const diff = generateWriteDiff('sample.ts', newContent, TEST_ROOT);
    expect(diff).toContain('- const x = 1;');
    expect(diff).toContain('+ const x = 999;');
  });

  it('shows no changes when content is identical', () => {
    const content = [
      'import { foo } from "./bar";',
      '',
      'const x = 1;',
      'const y = 2;',
      'const z = 3;',
      '',
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      '',
      'export default { x, y, z };',
    ].join('\n');
    const diff = generateWriteDiff('sample.ts', content, TEST_ROOT);
    expect(diff).toContain('no changes');
  });

  it('truncates preview for large new files', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const diff = generateWriteDiff('big-new.ts', lines, TEST_ROOT);
    expect(diff).toContain('more lines');
  });

  it('handles gracefully on read error', () => {
    // Pass an invalid root to trigger an error path
    const diff = generateWriteDiff('/nonexistent/path/file.ts', 'content', '/nonexistent/path');
    expect(typeof diff).toBe('string');
  });
});
