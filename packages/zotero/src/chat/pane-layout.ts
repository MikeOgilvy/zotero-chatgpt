/**
 * When the reader dock can hold two chat columns side by side, and which chat the second one shows.
 *
 * The dock is a Zotero attachment pane and is usually narrow, so two columns are a deliberate layout
 * that must be *measured* before it is used: below the threshold the tab strip is the UI, and a
 * half-width squeezed column is never rendered. Everything here is DOM-free so the rule can be
 * reasoned about (and tested) on its own.
 */

/**
 * The narrowest a chat column may be and still read as a chat, in CSS pixels of column content.
 *
 * Derivation from the shipped styles at the default chat text scale (`.zcr-sidebar` renders chat at
 * 13px, `--zcr-chat-text-scale: 1`):
 * - Assistant prose spans the whole column, and 13px proportional text averages roughly 6.5px per
 *   Latin character, so 280px is about 43 characters a line — the floor for prose that does not
 *   wrap every two or three words. A user bubble is capped at 92% of that, about 39 characters.
 * - The composer card spends 12px of padding a side and the textarea another 4px, so 280px leaves
 *   about 248px of typing width (~38 characters) — a full question line without feeling pinched.
 * - The composer footer must keep the plus, the region shortcut, the model chip and send on one row
 *   (four 28px controls plus gaps, roughly 200px), which 280px also satisfies.
 * Below this the transcript and the footer both start fighting for the same few pixels, which is
 * exactly the squeezed column the owner rejected.
 */
export const MIN_READABLE_CHAT_WIDTH = 280;

/** Whitespace between the editable column and the read-only one. */
export const COLUMN_GAP = 12;

/**
 * The split's own chrome: the gap plus the 1px separator rule, rounded up by one pixel, so each
 * column keeps a full `MIN_READABLE_CHAT_WIDTH` of content under either box-sizing model.
 */
export const SPLIT_CHROME = COLUMN_GAP + 2;

/** The measured container width from which two full readable columns fit. */
export const MIN_TWO_COLUMN_WIDTH = 2 * MIN_READABLE_CHAT_WIDTH + SPLIT_CHROME;

/**
 * How many columns fit in `availableWidth`. The minimum readable width is a text measure, so it
 * grows with the chat text scale: at 150% the same dock no longer fits two readable chats.
 */
export function readableColumnCount(availableWidth: number, chatTextScale = 1): 1 | 2 {
  const scale = Number.isFinite(chatTextScale) && chatTextScale > 0 ? chatTextScale : 1;
  const threshold = Math.ceil(2 * MIN_READABLE_CHAT_WIDTH * scale) + SPLIT_CHROME;
  return Number.isFinite(availableWidth) && availableWidth >= threshold ? 2 : 1;
}

/**
 * The chat the read-only column shows: the one the owner was editing a moment ago, so activating a
 * pane swaps the two roles instead of rearranging the dock. With no such history it is the
 * neighbouring tab — the open chat before the active one, else the next one — and `null` when there
 * is no second chat to show at all (one open chat, nothing on screen, or a chat opened from history
 * that was never a pane).
 */
export function previewChatId(activeId: string | null, previousActiveId: string | null, openIds: readonly string[]): string | null {
  if (!activeId) return null;
  const others = openIds.filter(id => id !== activeId);
  if (!others.length) return null;
  if (previousActiveId && previousActiveId !== activeId && others.includes(previousActiveId)) return previousActiveId;
  const index = openIds.indexOf(activeId);
  if (index >= 0) {
    const before = openIds[index - 1];
    if (before && before !== activeId) return before;
    const after = openIds[index + 1];
    if (after && after !== activeId) return after;
  }
  return others.at(-1) ?? null;
}
