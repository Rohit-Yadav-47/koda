import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { executeTool, getUndoStack, popUndo, toolSchemas, autoApprove } from '../src/tools/index.js';

const TEST_ROOT = join(process.cwd(), '.test-project');

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  writeFileSync(join(TEST_ROOT, 'hello.txt'), 'line1\nline2\nline3\n');
  writeFileSync(join(TEST_ROOT, 'code.ts'), 'const x = 1;\nconst y = 2;\nexport { x, y };\n');
  mkdirSync(join(TEST_ROOT, 'src'), { recursive: true });
  writeFileSync(join(TEST_ROOT, 'src', 'app.ts'), 'import { x } from "../code";\nconsole.log(x);\n');
  // Clear undo stack
  while (popUndo()) {}
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('Tool Schemas', () => {
  it('has 7 tools defined', () => {
    expect(toolSchemas.length).toBe(7);
  });

  it('all schemas have required fields', () => {
    for (const schema of toolSchemas) {
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBeTruthy();
      expect(schema.function.description).toBeTruthy();
      expect(schema.function.parameters).toBeDefined();
    }
  });

  it('auto-approve set contains read-only tools', () => {
    expect(autoApprove.has('read_file')).toBe(true);
    expect(autoApprove.has('search_code')).toBe(true);
    expect(autoApprove.has('glob_files')).toBe(true);
    expect(autoApprove.has('write_file')).toBe(false);
    expect(autoApprove.has('run_terminal')).toBe(false);
  });
});

describe('read_file', () => {
  it('reads a file with line numbers', async () => {
    const result = await executeTool('read_file', { path: 'hello.txt' }, TEST_ROOT);
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
    expect(result).toContain('3\tline3');
  });

  it('reads with offset and limit', async () => {
    const result = await executeTool('read_file', { path: 'hello.txt', offset: 1, limit: 1 }, TEST_ROOT);
    expect(result).toContain('2\tline2');
    expect(result).not.toContain('1\tline1');
    expect(result).not.toContain('3\tline3');
  });

  it('throws on path traversal', async () => {
    await expect(executeTool('read_file', { path: '../../etc/passwd' }, TEST_ROOT)).rejects.toThrow('escapes');
  });

  it('throws on nonexistent file', async () => {
    await expect(executeTool('read_file', { path: 'nope.txt' }, TEST_ROOT)).rejects.toThrow();
  });
});

describe('write_file', () => {
  it('writes a new file', async () => {
    const result = await executeTool('write_file', { path: 'new.txt', content: 'hello world' }, TEST_ROOT);
    expect(result).toContain('11 bytes');
    expect(readFileSync(join(TEST_ROOT, 'new.txt'), 'utf-8')).toBe('hello world');
  });

  it('creates parent directories', async () => {
    await executeTool('write_file', { path: 'deep/nested/file.txt', content: 'deep' }, TEST_ROOT);
    expect(readFileSync(join(TEST_ROOT, 'deep/nested/file.txt'), 'utf-8')).toBe('deep');
  });

  it('overwrites existing file', async () => {
    await executeTool('write_file', { path: 'hello.txt', content: 'new content' }, TEST_ROOT);
    expect(readFileSync(join(TEST_ROOT, 'hello.txt'), 'utf-8')).toBe('new content');
  });

  it('adds to undo stack', async () => {
    await executeTool('write_file', { path: 'hello.txt', content: 'changed' }, TEST_ROOT);
    const stack = getUndoStack();
    expect(stack.length).toBe(1);
    expect(stack[0].previousContent).toBe('line1\nline2\nline3\n');
  });

  it('undo stack stores null for new files', async () => {
    await executeTool('write_file', { path: 'brand_new.txt', content: 'new' }, TEST_ROOT);
    const change = popUndo();
    expect(change?.previousContent).toBeNull();
  });

  it('throws on path traversal', async () => {
    await expect(executeTool('write_file', { path: '../outside.txt', content: 'bad' }, TEST_ROOT)).rejects.toThrow('escapes');
  });
});

describe('edit_file', () => {
  it('replaces a string in a file', async () => {
    const result = await executeTool('edit_file', { path: 'code.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' }, TEST_ROOT);
    expect(result).toContain('Edited');
    expect(readFileSync(join(TEST_ROOT, 'code.ts'), 'utf-8')).toContain('const x = 42;');
  });

  it('throws if string not found', async () => {
    await expect(
      executeTool('edit_file', { path: 'code.ts', old_string: 'not here', new_string: 'x' }, TEST_ROOT)
    ).rejects.toThrow('not found');
  });

  it('throws if multiple matches', async () => {
    writeFileSync(join(TEST_ROOT, 'dupe.txt'), 'aaa\naaa\n');
    await expect(
      executeTool('edit_file', { path: 'dupe.txt', old_string: 'aaa', new_string: 'bbb' }, TEST_ROOT)
    ).rejects.toThrow('matches');
  });

  it('adds to undo stack with previous content', async () => {
    const before = readFileSync(join(TEST_ROOT, 'code.ts'), 'utf-8');
    await executeTool('edit_file', { path: 'code.ts', old_string: 'const x = 1;', new_string: 'const x = 99;' }, TEST_ROOT);
    const change = popUndo();
    expect(change?.previousContent).toBe(before);
  });
});

describe('run_terminal', () => {
  it('runs a command and returns output', async () => {
    const result = await executeTool('run_terminal', { command: 'echo hello' }, TEST_ROOT);
    expect(result.trim()).toBe('hello');
  });

  it('returns exit code on failure', async () => {
    const result = await executeTool('run_terminal', { command: 'ls /nonexistent_dir_xyz' }, TEST_ROOT);
    expect(result).toContain('Exit code');
  });

  it('respects cwd', async () => {
    const result = await executeTool('run_terminal', { command: 'pwd', cwd: 'src' }, TEST_ROOT);
    expect(result.trim()).toBe(join(TEST_ROOT, 'src'));
  });

  it('throws on cwd path traversal', async () => {
    await expect(
      executeTool('run_terminal', { command: 'pwd', cwd: '../../' }, TEST_ROOT)
    ).rejects.toThrow('escapes');
  });
});

describe('search_code', () => {
  it('finds matches across files', async () => {
    const result = await executeTool('search_code', { pattern: 'const' }, TEST_ROOT);
    expect(result).toContain('code.ts');
    expect(result).toContain('const x');
  });

  it('returns no matches message', async () => {
    const result = await executeTool('search_code', { pattern: 'zzzznothere' }, TEST_ROOT);
    expect(result).toContain('No matches');
  });

  it('supports context lines', async () => {
    const result = await executeTool('search_code', { pattern: 'const y', context_lines: 1 }, TEST_ROOT);
    expect(result).toContain('const x'); // context line before
  });

  it('searches subdirectory when path given', async () => {
    const result = await executeTool('search_code', { pattern: 'import', path: 'src' }, TEST_ROOT);
    expect(result).toContain('app.ts');
  });
});

describe('glob_files', () => {
  it('finds files matching pattern', async () => {
    const result = await executeTool('glob_files', { pattern: '**/*.ts' }, TEST_ROOT);
    expect(result).toContain('code.ts');
    expect(result).toContain('src/app.ts');
  });

  it('finds txt files', async () => {
    const result = await executeTool('glob_files', { pattern: '*.txt' }, TEST_ROOT);
    expect(result).toContain('hello.txt');
  });

  it('returns no match message', async () => {
    const result = await executeTool('glob_files', { pattern: '**/*.xyz' }, TEST_ROOT);
    expect(result).toContain('No files matched');
  });
});

describe('Undo Stack', () => {
  it('pop returns undefined when empty', () => {
    expect(popUndo()).toBeUndefined();
  });

  it('undo restores file content', async () => {
    const original = readFileSync(join(TEST_ROOT, 'hello.txt'), 'utf-8');
    await executeTool('write_file', { path: 'hello.txt', content: 'overwritten' }, TEST_ROOT);
    expect(readFileSync(join(TEST_ROOT, 'hello.txt'), 'utf-8')).toBe('overwritten');

    const change = popUndo()!;
    writeFileSync(change.path, change.previousContent!, 'utf-8');
    expect(readFileSync(join(TEST_ROOT, 'hello.txt'), 'utf-8')).toBe(original);
  });

  it('undo for new file has null previousContent', async () => {
    await executeTool('write_file', { path: 'created.txt', content: 'new' }, TEST_ROOT);
    const change = popUndo()!;
    expect(change.previousContent).toBeNull();
    expect(change.tool).toBe('write_file');
  });

  it('multiple undos pop in reverse order', async () => {
    await executeTool('write_file', { path: 'a.txt', content: 'a' }, TEST_ROOT);
    await executeTool('write_file', { path: 'b.txt', content: 'b' }, TEST_ROOT);
    const second = popUndo()!;
    const first = popUndo()!;
    expect(second.path).toContain('b.txt');
    expect(first.path).toContain('a.txt');
  });
});

describe('Sandbox', () => {
  it('blocks absolute paths outside root', async () => {
    await expect(executeTool('read_file', { path: '/etc/passwd' }, TEST_ROOT)).rejects.toThrow('escapes');
  });

  it('blocks ../ traversal', async () => {
    await expect(executeTool('read_file', { path: '../../../etc/passwd' }, TEST_ROOT)).rejects.toThrow('escapes');
  });

  it('allows paths within root', async () => {
    const result = await executeTool('read_file', { path: 'src/app.ts' }, TEST_ROOT);
    expect(result).toContain('import');
  });
});

describe('executeTool', () => {
  it('throws on unknown tool', async () => {
    await expect(executeTool('nonexistent_tool', {}, TEST_ROOT)).rejects.toThrow('Unknown tool');
  });
});
