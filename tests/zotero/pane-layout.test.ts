import { expect, it } from 'vitest';
import { MIN_READABLE_CHAT_WIDTH, MIN_TWO_COLUMN_WIDTH, previewChatId, readableColumnCount } from '../../packages/zotero/src/chat/pane-layout.ts';

it('opens the second column only when each column keeps a full readable chat width', () => {
  // The threshold is the two readable columns plus the split's own chrome (the row gap and the
  // separator rule); it is derived, not guessed, so a wider gap can never silently squeeze a column.
  expect(MIN_TWO_COLUMN_WIDTH).toBe(2 * MIN_READABLE_CHAT_WIDTH + 14);
  expect(readableColumnCount(MIN_TWO_COLUMN_WIDTH - 1)).toBe(1);
  expect(readableColumnCount(MIN_TWO_COLUMN_WIDTH)).toBe(2);
  // A dock that has not been measured (or reports nonsense) is never treated as room for two.
  expect(readableColumnCount(0)).toBe(1);
  expect(readableColumnCount(Number.NaN)).toBe(1);
});

it('raises the threshold with the chat text scale instead of squeezing the columns', () => {
  const scaled = Math.ceil(2 * MIN_READABLE_CHAT_WIDTH * 1.5) + 14;
  expect(readableColumnCount(scaled - 1, 1.5)).toBe(1);
  expect(readableColumnCount(scaled, 1.5)).toBe(2);
  // The same dock that fits two columns at the default scale does not at 150%: the minimum readable
  // width is a text measure, and the chats are scaled independently of the PDF.
  expect(readableColumnCount(MIN_TWO_COLUMN_WIDTH, 1.5)).toBe(1);
  // A missing scale is the default, never a division or a zero column.
  expect(readableColumnCount(MIN_TWO_COLUMN_WIDTH, 0)).toBe(2);
});

it('shows the chat that was just being edited, and otherwise the neighbouring tab', () => {
  // Activation swaps the two roles, so the chat the owner just left is the one shown read-only.
  expect(previewChatId('b', 'a', ['a', 'b'])).toBe('a');
  expect(previewChatId('a', 'b', ['a', 'b'])).toBe('b');
  // A chat that is no longer open cannot hold the column.
  expect(previewChatId('b', 'gone', ['a', 'b', 'c'])).toBe('a');
  // Without a history the neighbouring tab wins: the one before the active chat, else the next one.
  expect(previewChatId('b', null, ['a', 'b', 'c'])).toBe('a');
  expect(previewChatId('c', null, ['a', 'b', 'c'])).toBe('b');
  expect(previewChatId('a', null, ['a', 'b', 'c'])).toBe('b');
  // The chat on screen never previews itself, and a chat opened from history keeps its neighbour.
  expect(previewChatId('a', 'a', ['a', 'b'])).toBe('b');
  expect(previewChatId('c', 'a', ['a', 'b'])).toBe('a');
  // One open chat — or nothing on screen — has no second column at all, however the tabs are listed.
  expect(previewChatId('a', null, ['a'])).toBeNull();
  expect(previewChatId(null, 'a', ['a', 'b'])).toBeNull();
  expect(previewChatId('a', null, [])).toBeNull();
});
