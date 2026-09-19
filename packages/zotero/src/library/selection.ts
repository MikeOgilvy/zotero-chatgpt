import { ReaderError } from '../../../contracts/src/index.ts';
import type { NativeOrganizationItemSnapshot, NativeReaderPort } from '../../../contracts/src/native.ts';

const KEY = /^[A-Z0-9]{8}$/u;
const MAX_SELECTED_ITEMS = 50;

export interface SelectedLibraryHostItem {
  id: number;
  key: string;
  libraryID: number;
  deleted?: boolean;
  isRegularItem(): boolean;
}

export interface SelectedLibraryWindow {
  ZoteroPane?: { itemsView?: { getSelectedItems(asIDs?: false): SelectedLibraryHostItem[] } };
}

export interface SelectedLibraryOptions {
  clientId: string;
  getWindow(): SelectedLibraryWindow | undefined;
  reader: Pick<NativeReaderPort, 'inspectOrganizationItem'>;
}

/**
 * Freeze the active library pane's actual regular-item selection. Item keys are read from Zotero and
 * never accepted from model output; every result is immediately read back through the native port.
 */
export async function captureSelectedLibraryItems(options: SelectedLibraryOptions): Promise<NativeOrganizationItemSnapshot[]> {
  // ZoteroPane.getSelectedItems() is tab-sensitive: while a Reader tab is active it returns that
  // reader's parent item, not the rows the owner selected in the library item tree. The window-bound
  // itemsView retains the actual library-row selection across a switch back to the Reader.
  const itemsView = options.getWindow()?.ZoteroPane?.itemsView;
  if (!itemsView?.getSelectedItems) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The selected Zotero library rows are unavailable. Return to the library, select the items, and try again.');
  const raw = itemsView.getSelectedItems(false);
  if (!Array.isArray(raw)) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The active Zotero library selection is unavailable.');
  // Copy every identity before the first await so later focus/selection changes cannot retarget the task.
  const selected = raw.filter(item => item && !item.deleted && item.isRegularItem()).map(item => ({ libraryID: item.libraryID, key: item.key }));
  if (!selected.length) throw new ReaderError('INVALID_REQUEST', 'Select one or more regular Zotero items before organizing them.');
  if (selected.length > MAX_SELECTED_ITEMS) throw new ReaderError('PAYLOAD_TOO_LARGE', `Organize at most ${MAX_SELECTED_ITEMS} selected items at a time.`);
  if (new Set(selected.map(item => item.libraryID)).size !== 1) throw new ReaderError('INVALID_REQUEST', 'Organize items from one Zotero library at a time.');
  const seen = new Set<string>();
  const frozen: NativeOrganizationItemSnapshot[] = [];
  for (const item of selected) {
    if (!Number.isSafeInteger(item.libraryID) || item.libraryID < 1 || !KEY.test(item.key)) throw new ReaderError('INVALID_REQUEST', 'The Zotero selection contains an invalid item identity.');
    const identity = `${item.libraryID}:${item.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const snapshot = await options.reader.inspectOrganizationItem({ clientId: options.clientId, libraryId: item.libraryID, key: item.key });
    if (!snapshot) throw new ReaderError('NOT_FOUND', 'A selected Zotero item changed or disappeared while its scope was being frozen.');
    frozen.push(snapshot);
  }
  if (!frozen.length) throw new ReaderError('INVALID_REQUEST', 'Select one or more regular Zotero items before organizing them.');
  return frozen;
}
