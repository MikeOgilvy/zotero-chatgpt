import { describe, expect, it } from 'vitest';
import {
  canonicalOfficialConversationURL,
  parseOfficialConversationStore,
  rememberOfficialConversation,
} from '../../../packages/zotero/src/chat/official-chat-history.ts';

describe('official ChatGPT conversation URL storage', () => {
  it('keeps only canonical official /c ids and drops query, fragment and lookalike origins', () => {
    expect(canonicalOfficialConversationURL('https://chatgpt.com/c/12345678-abcd?utm=x#tail')).toBe('https://chatgpt.com/c/12345678-abcd');
    for (const value of [
      'http://chatgpt.com/c/12345678',
      'https://user:secret@chatgpt.com/c/12345678',
      'https://chatgpt.com.evil.invalid/c/12345678',
      'https://chatgpt.com/share/12345678',
      'https://chatgpt.com/c/x',
    ]) expect(canonicalOfficialConversationURL(value), value).toBeNull();
  });

  it('stores a separate bounded URL per frozen paper binding and keeps newest entries', () => {
    let store = rememberOfficialConversation({}, 'profile:1:paper-a', 'https://chatgpt.com/c/aaaaaaaa', '2026-09-19T00:00:00Z', 2);
    store = rememberOfficialConversation(store, 'profile:1:paper-b', 'https://chatgpt.com/c/bbbbbbbb', '2026-09-19T01:00:00Z', 2);
    store = rememberOfficialConversation(store, 'profile:1:paper-c', 'https://chatgpt.com/c/cccccccc', '2026-09-19T02:00:00Z', 2);
    expect(Object.keys(store).sort()).toEqual(['profile:1:paper-b', 'profile:1:paper-c']);
    expect(store['profile:1:paper-c']?.url).toBe('https://chatgpt.com/c/cccccccc');
  });

  it('rejects malformed or oversized persisted preference data', () => {
    expect(parseOfficialConversationStore('not json')).toEqual({});
    expect(parseOfficialConversationStore('x'.repeat(140_000))).toEqual({});
    expect(parseOfficialConversationStore(JSON.stringify({ bad: { url: 'https://evil.invalid/c/12345678', updatedAt: 'now' } }))).toEqual({});
  });
});
