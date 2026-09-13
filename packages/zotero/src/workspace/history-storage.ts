import { SHAREABLE_STORAGE_LOCATION } from '../../../contracts/src/index.ts';
import type { HistoryStorageChat, HistoryStorageReport, HistoryStorageStop } from '../../../contracts/src/workspace.ts';
import type { FileHost } from '../runtime/storage.ts';

/**
 * Bounded measurement of the plugin's own records store, for the History section's "Calculate size"
 * action.
 *
 * Guarantees, in the order they are enforced:
 *
 * 1. Scope: the walk is rooted at `<profileDir>/zotero-codex-reader/v1/records` — a sibling of the
 *    Codex account home (`.../v1/account`, the only place credentials live) and of `.../v1/home`.
 *    Nothing outside that one subtree is listed, stat'ed, read or logged. `scope` in the report
 *    echoes that subtree so the owner can audit it without trusting this comment.
 * 2. Reads: only `getChildren` and `stat` are used. No file content is ever read, so no chat text,
 *    draft, extracted PDF body or credential file can end up in a log or in the report.
 * 3. Links: a symlink is never followed. Encountering one stops the walk (`entry-type`) and the
 *    figure becomes a lower bound.
 * 4. Bounds: at most `entries` children are visited, at most `bytes` bytes are counted, and no
 *    directory deeper than `depth` levels is entered. Exceeding any of them stops the walk and the
 *    report says `complete: false` with the bound that stopped it, so the pane can only ever say
 *    "at least". Per-chat detail degrades first: it is capped at `chats` rows, largest first.
 */
export interface HistoryStorageLimits { entries: number; bytes: number; depth: number; chats: number }

export const HISTORY_STORAGE_LIMITS: HistoryStorageLimits = Object.freeze({ entries: 20_000, bytes: 1 << 30, depth: 4, chats: 500 });

/** The subtree below the profile directory that this walk is allowed to touch, and only it. */
export const HISTORY_STORAGE_SCOPE = SHAREABLE_STORAGE_LOCATION.replace(/^Zotero profile\//u, '');
const RECORDS_PARTS = HISTORY_STORAGE_SCOPE.split('/');
const CHAT_DIRECTORY = 'conversations';
const DRAFT_DIRECTORY = 'workspace/drafts';
const CHAT_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;

interface Counted { bytes: number; files: number; chatBytes: number; draftBytes: number }
interface Walk { host: FileHost & { profileDir: string }; limits: HistoryStorageLimits; counted: Counted; chats: Map<string, number>; stop: HistoryStorageStop | null; visited: number }
function stop(walk: Walk, reason: HistoryStorageStop): void { if (!walk.stop) walk.stop = reason; }
function chatIdOf(name: string): string | null {
  const head = name.slice(0, 36);
  return name.length > 36 && name[36] === '.' && CHAT_ID.test(head) ? head : null;
}

/** Depth-first, sorted, so the same tree always truncates at the same place and the numbers agree. */
async function walkDirectory(walk: Walk, directory: string, relative: string, depth: number): Promise<void> {
  if (walk.stop) return;
  const getChildren = walk.host.io.getChildren?.bind(walk.host.io);
  if (!getChildren) { stop(walk, 'listing'); return; }
  let children: string[];
  try { children = await getChildren(directory); } catch { stop(walk, 'listing'); return; }
  for (const child of [...children].sort()) {
    if (walk.stop) return;
    if (walk.visited >= walk.limits.entries) { stop(walk, 'entries'); return; }
    const name = child.split(/[\\/]/u).at(-1)!;
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) { stop(walk, 'entry-type'); return; }
    if (walk.host.isSymlink(child)) { stop(walk, 'entry-type'); return; }
    let info: { type: string; size: number };
    try { info = await walk.host.io.stat(child); } catch { stop(walk, 'listing'); return; }
    walk.visited += 1;
    const nested = relative ? `${relative}/${name}` : name;
    if (info.type === 'directory') {
      if (depth + 1 > walk.limits.depth) { stop(walk, 'depth'); return; }
      await walkDirectory(walk, child, nested, depth + 1);
      continue;
    }
    if (info.type !== 'regular' || !Number.isSafeInteger(info.size) || info.size < 0) { stop(walk, 'entry-type'); return; }
    walk.counted.bytes += info.size;
    walk.counted.files += 1;
    if (relative === CHAT_DIRECTORY) {
      walk.counted.chatBytes += info.size;
      const id = chatIdOf(name);
      if (id) walk.chats.set(id, (walk.chats.get(id) ?? 0) + info.size);
    } else if (nested.startsWith(`${DRAFT_DIRECTORY}/`)) walk.counted.draftBytes += info.size;
    if (walk.counted.bytes >= walk.limits.bytes) { stop(walk, 'bytes'); return; }
  }
}

/**
 * Returns a reader that measures the records store when called. Nothing runs at construction, so the
 * plugin pays nothing until the owner asks for a size.
 */
export function createHistoryStorageReader(host: FileHost & { profileDir: string }, overrides: Partial<HistoryStorageLimits> = {}): () => Promise<HistoryStorageReport> {
  const limits: HistoryStorageLimits = { ...HISTORY_STORAGE_LIMITS, ...overrides };
  const location = host.join(host.profileDir, ...RECORDS_PARTS);
  return async () => {
    const walk: Walk = { host, limits, counted: { bytes: 0, files: 0, chatBytes: 0, draftBytes: 0 }, chats: new Map(), stop: null, visited: 0 };
    const measuredAt = new Date().toISOString();
    if (!host.io.getChildren) stop(walk, 'listing');
    else {
      try {
        if (await host.io.exists(location) && (await host.io.stat(location)).type === 'directory') await walkDirectory(walk, location, '', 1);
      } catch { stop(walk, 'listing'); }
    }
    const ranked = [...walk.chats.entries()].map(([id, bytes]) => ({ id, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
    const chats: HistoryStorageChat[] = ranked.slice(0, limits.chats);
    const { bytes, files, chatBytes, draftBytes } = walk.counted;
    return {
      location, scope: HISTORY_STORAGE_SCOPE, bytes, chatBytes, draftBytes, otherBytes: bytes - chatBytes - draftBytes, files,
      chats, chatsComplete: chats.length === ranked.length, complete: walk.stop === null, stoppedBy: walk.stop,
      limits: { entries: limits.entries, bytes: limits.bytes, depth: limits.depth }, measuredAt,
    };
  };
}
