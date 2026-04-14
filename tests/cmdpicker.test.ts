import { describe, it, expect } from 'vitest';
import { COMMANDS, completer, getFilteredCommand, getFilteredCount } from '../src/ui/cmdpicker.js';

describe('Command Definitions', () => {
  it('has commands defined', () => {
    expect(COMMANDS.length).toBeGreaterThan(20);
  });

  it('all commands start with /', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.cmd.startsWith('/')).toBe(true);
    }
  });

  it('all commands have descriptions', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.desc.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate commands', () => {
    const names = COMMANDS.map(c => c.cmd);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('aliases are unique', () => {
    const aliases = COMMANDS.map(c => c.alias).filter(Boolean) as string[];
    const unique = new Set(aliases);
    expect(unique.size).toBe(aliases.length);
  });
});

describe('Completer', () => {
  it('returns all commands for /', () => {
    const [hits] = completer('/');
    expect(hits.length).toBeGreaterThan(10);
  });

  it('filters on partial input', () => {
    const [hits] = completer('/he');
    expect(hits).toContain('/help');
    expect(hits).not.toContain('/quit');
  });

  it('returns empty for non-/ input', () => {
    const [hits] = completer('hello');
    expect(hits).toEqual([]);
  });

  it('includes aliases in results', () => {
    const [hits] = completer('/h');
    expect(hits).toContain('/help');
    expect(hits).toContain('/history');
  });
});

describe('getFilteredCommand', () => {
  it('returns first matching command at index 0', () => {
    const cmd = getFilteredCommand('/he', 0);
    expect(cmd).not.toBeNull();
    expect(cmd!.cmd).toBe('/help');
  });

  it('returns null for non-/ input', () => {
    expect(getFilteredCommand('hello', 0)).toBeNull();
  });

  it('returns correct command at index', () => {
    const count = getFilteredCount('/');
    expect(count).toBe(COMMANDS.length);
    const first = getFilteredCommand('/', 0);
    const second = getFilteredCommand('/', 1);
    expect(first!.cmd).not.toBe(second!.cmd);
  });

  it('returns null for out of bounds index', () => {
    expect(getFilteredCommand('/help', 999)).toBeNull();
  });
});

describe('getFilteredCount', () => {
  it('returns all commands for /', () => {
    expect(getFilteredCount('/')).toBe(COMMANDS.length);
  });

  it('returns filtered count for partial', () => {
    const count = getFilteredCount('/co');
    expect(count).toBeGreaterThan(0);
    // /config, /commit, /compact, /context, /copy
    expect(count).toBeLessThan(COMMANDS.length);
  });

  it('returns 0 for non-/ input', () => {
    expect(getFilteredCount('hello')).toBe(0);
  });

  it('returns 0 for no matches', () => {
    expect(getFilteredCount('/zzzzz')).toBe(0);
  });
});
