import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConfig, setConfig, getAllConfig,
  createConversation, listConversations, getConversation, deleteConversation,
  addMessage, getMessages, clearMessages,
} from '../src/db/store.js';

describe('Config', () => {
  it('set and get a config value', () => {
    setConfig('test_key', 'test_value');
    expect(getConfig('test_key')).toBe('test_value');
  });

  it('overwrite a config value', () => {
    setConfig('test_key', 'first');
    setConfig('test_key', 'second');
    expect(getConfig('test_key')).toBe('second');
  });

  it('return undefined for missing key', () => {
    expect(getConfig('nonexistent_key_xyz')).toBeUndefined();
  });

  it('getAllConfig returns all entries', () => {
    setConfig('gc_a', '1');
    setConfig('gc_b', '2');
    const all = getAllConfig();
    expect(all['gc_a']).toBe('1');
    expect(all['gc_b']).toBe('2');
  });
});

describe('Conversations', () => {
  it('create a conversation', () => {
    const convo = createConversation('Test Chat', '/tmp/test');
    expect(convo.id).toBeGreaterThan(0);
    expect(convo.title).toBe('Test Chat');
    expect(convo.project_root).toBe('/tmp/test');
  });

  it('list conversations returns results', () => {
    createConversation('List A', '/tmp/listtest');
    createConversation('List B', '/tmp/listtest');
    const list = listConversations();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const titles = list.map(c => c.title);
    expect(titles).toContain('List A');
    expect(titles).toContain('List B');
  });

  it('get conversation by id', () => {
    const created = createConversation('Get By ID', '/tmp');
    const found = getConversation(created.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Get By ID');
  });

  it('get nonexistent conversation returns undefined', () => {
    expect(getConversation(999999)).toBeUndefined();
  });

  it('delete a conversation', () => {
    const convo = createConversation('To Delete', '/tmp');
    deleteConversation(convo.id);
    expect(getConversation(convo.id)).toBeUndefined();
  });

  it('deleting conversation cascades to messages', () => {
    const convo = createConversation('Cascade Test', '/tmp');
    addMessage(convo.id, 'user', 'hello');
    addMessage(convo.id, 'assistant', 'hi');
    deleteConversation(convo.id);
    expect(getMessages(convo.id)).toEqual([]);
  });
});

describe('Messages', () => {
  it('add and retrieve messages', () => {
    const convo = createConversation('Msg Test', '/tmp');
    addMessage(convo.id, 'user', 'hello');
    addMessage(convo.id, 'assistant', 'world');
    const msgs = getMessages(convo.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hello');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('world');
  });

  it('messages ordered by created_at', () => {
    const convo = createConversation('Order Test', '/tmp');
    addMessage(convo.id, 'user', 'first');
    addMessage(convo.id, 'assistant', 'second');
    addMessage(convo.id, 'user', 'third');
    const msgs = getMessages(convo.id);
    expect(msgs[0].content).toBe('first');
    expect(msgs[2].content).toBe('third');
  });

  it('add message with tool_calls JSON', () => {
    const convo = createConversation('Tool Test', '/tmp');
    const toolCalls = [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }];
    addMessage(convo.id, 'assistant', null, toolCalls);
    const msgs = getMessages(convo.id);
    expect(msgs[0].tool_calls).toBe(JSON.stringify(toolCalls));
  });

  it('add message with tool_call_id', () => {
    const convo = createConversation('Tool Result Test', '/tmp');
    addMessage(convo.id, 'tool', 'file contents here', undefined, 'tc1');
    const msgs = getMessages(convo.id);
    expect(msgs[0].tool_call_id).toBe('tc1');
  });

  it('clear messages', () => {
    const convo = createConversation('Clear Test', '/tmp');
    addMessage(convo.id, 'user', 'a');
    addMessage(convo.id, 'assistant', 'b');
    clearMessages(convo.id);
    expect(getMessages(convo.id)).toEqual([]);
  });
});
