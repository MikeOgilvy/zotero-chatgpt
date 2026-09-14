import { paperId, type PaperScope, type Rect } from '../../../contracts/src/index.ts';

/**
 * The PDF region the owner most recently selected, per paper.
 *
 * Region capture used to read the last citation in the draft (`ConversationPresenter.captureRegion`'s
 * default argument). That only ever worked after a selection had been pushed into the draft through
 * "Ask in sidechat": selecting a region and clicking the composer's capture button rejected with
 * "Select a PDF region before capturing it.", which is what the owner saw as "the screenshot feature
 * does not work".
 *
 * The selection popup is the only place where the page and the rects of a live selection exist, and
 * it is handled in the plugin realm (`index.ts`), not in the sidebar. So the popup records the region
 * here and the capture button reads it back — no citation has to be created first, and the region is
 * never inferred from whatever reference happens to sit in the draft.
 *
 * The registry is deliberately small and lifetime-bounded: the newest selection for a paper wins,
 * only the newest {@link MAX_PAPERS} papers are remembered, and a reader that unloads forgets its
 * paper, so a long session cannot accumulate coordinates for PDFs that are no longer open.
 */
export interface SelectedRegion { pageIndex: number; rects: Rect[] }

const MAX_PAPERS = 16;
/** Insertion-ordered, so the first key is the oldest paper and the bound is a single delete. */
const regions = new Map<string, SelectedRegion>();

/** Records a selection for a paper; a malformed page or an empty rect list is ignored, not stored. */
export function rememberSelection(paper: PaperScope, region: SelectedRegion): void {
  if (!Number.isSafeInteger(region.pageIndex) || region.pageIndex < 0 || region.rects.length === 0) return;
  const key = paperId(paper);
  regions.delete(key);
  regions.set(key, { pageIndex: region.pageIndex, rects: region.rects.map(rect => [...rect] as Rect) });
  while (regions.size > MAX_PAPERS) {
    const oldest = regions.keys().next().value;
    if (oldest === undefined) break;
    regions.delete(oldest);
  }
}

/**
 * The remembered region of a paper, or `undefined` when the owner has not selected anything in it
 * since it was opened. A copy is returned so a caller cannot mutate the registry.
 */
export function currentSelection(paper: PaperScope): SelectedRegion | undefined {
  const region = regions.get(paperId(paper));
  return region ? { pageIndex: region.pageIndex, rects: region.rects.map(rect => [...rect] as Rect) } : undefined;
}

/** Forgets a paper's region when its reader unloads; the coordinates die with the open PDF. */
export function forgetSelection(paper: PaperScope): void {
  regions.delete(paperId(paper));
}
