import { ReaderError, type DocumentRevision, type PaperScope } from './index.ts';
import type { NativeAcquisitionResult, NativeAnnotationSnapshot, NativeCollectionAddition, NativeCollectionTarget, NativeItemSnapshot, NativeMetadataPreview, NativeQuoteResolution } from './native.ts';

export interface AnnotationProposal { quote: string; pageIndex: number; reason: string }
/**
 * Untrusted model/user JSON is validated here, next to the contract it produces. The helpers mirror
 * the task controller's task-input validator so the relocated candidate parser keeps byte-identical
 * error text and limits; like `validation.ts`, they stay module-local rather than shared.
 */
function invalid(): never { throw new ReaderError('INVALID_REQUEST', 'The task input is invalid or no longer matches its review.'); }
function text(value: unknown, max: number, min = 0): string { if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0')) invalid(); return value; }
function record(value: unknown, allowed?: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); const object = value as Record<string, unknown>; if (allowed && Object.keys(object).some(k => !allowed.includes(k))) invalid(); return object; }
/** One model-proposed annotation, before the controller resolves it against a frozen PDF version. */
export function validateAnnotationProposal(value: unknown): AnnotationProposal {
  const p = record(value, ['quote', 'pageIndex', 'reason']);
  if (!Number.isSafeInteger(p.pageIndex) || (p.pageIndex as number) < 0 || (p.pageIndex as number) >= 10000) invalid();
  // `reason` only becomes the annotation comment. A model that omits it still has to supply an exact
  // quote and a valid page, so treating it as empty keeps a resolvable candidate instead of dropping
  // the whole batch. Extra keys remain rejected: the allowlist is what stops model-chosen write fields.
  return { quote: text(p.quote, 16000, 2), pageIndex: p.pageIndex as number, reason: p.reason === undefined ? '' : text(p.reason, 4000) };
}
export function parseAnnotationCandidates(value: string): AnnotationProposal[] {
  text(value, 1024 * 1024, 2);
  let parsed: unknown; try { parsed = JSON.parse(value) as unknown; } catch { invalid(); }
  const result = record(parsed, ['candidates']); if (!Array.isArray(result.candidates) || result.candidates.length > 50) invalid();
  return result.candidates.map(validateAnnotationProposal);
}
/**
 * State of one durable native action task. The task controller owns the transition; a view only
 * projects it. `uncertain` means the write may or may not have landed and must be reconciled by its
 * reserved key, never blindly retried.
 */
export type ActionTaskState = 'preparing' | 'review' | 'running' | 'completed' | 'partial' | 'cancelled' | 'uncertain' | 'undone' | 'conflict' | 'failed';
export type ActionTaskItemStatus = 'candidate' | 'unresolved' | 'skipped' | 'writing' | 'applied' | 'metadata-only' | 'failed' | 'uncertain' | 'undoing' | 'undone' | 'conflict';
export type ActionTaskOperation = 'annotation-create' | 'metadata-create' | 'collection-add' | 'pdf-acquire' | 'annotation-delete' | 'collection-remove' | 'item-trash' | 'attachment-trash';
interface TaskItemBase {
  id: string;
  reservedKey: string;
  status: ActionTaskItemStatus;
  operation?: ActionTaskOperation;
  errorCode?: string;
  selected?: boolean;
}
export interface AnnotationTaskItem extends TaskItemBase {
  kind: 'annotation';
  proposal: AnnotationProposal;
  resolution?: NativeQuoteResolution;
  annotation?: NativeAnnotationSnapshot;
}
export interface AcquisitionTaskItem extends TaskItemBase {
  kind: 'acquisition';
  identifier: string;
  preview?: NativeMetadataPreview;
  duplicates: NativeItemSnapshot[];
  choice?: AcquisitionChoice;
  item?: NativeItemSnapshot;
  created?: boolean;
  collectionAddition?: NativeCollectionAddition;
  acquisition?: NativeAcquisitionResult;
  attachmentUndone?: true;
}
export interface AcquisitionChoice { metadataIndex?: number; duplicateKey?: string; downloadPDF?: boolean }
export type ActionTaskChoices = Record<string, AcquisitionChoice>;
interface ActionTaskBase {
  schemaVersion: 1;
  id: string;
  conversationId: string;
  question: string;
  state: ActionTaskState;
  createdAt: string;
  updatedAt: string;
  revision: number;
  approvedAt?: string;
  cancelRequested?: true;
}
export type ActionTaskRecord =
  | (ActionTaskBase & { kind: 'annotations'; paper: PaperScope; documentRevision: DocumentRevision; modelRequestId?: string; items: AnnotationTaskItem[] })
  | (ActionTaskBase & { kind: 'acquisition'; target: NativeCollectionTarget; items: AcquisitionTaskItem[] });
export interface AnnotationTaskPlan { conversationId: string; paper: PaperScope; revision: DocumentRevision; question: string; modelRequestId?: string; candidates: AnnotationProposal[] }
export interface AcquisitionTaskPlan { conversationId: string; target: NativeCollectionTarget; question: string; identifiers: string[] }
/** Durable action-task ledger surfaced to the UI; the implementation is `core/tasks`. */
export interface ActionTasks {
  list(conversationId?: string): Promise<ActionTaskRecord[]>;
  get(id: string): Promise<ActionTaskRecord>;
  subscribe(listener: (record: ActionTaskRecord) => void): () => void;
  planAnnotations(input: AnnotationTaskPlan): Promise<ActionTaskRecord>;
  planAcquisition(input: AcquisitionTaskPlan): Promise<ActionTaskRecord>;
  approve(id: string, selectedItemIds: string[], choices?: ActionTaskChoices): Promise<ActionTaskRecord>;
  cancel(id: string): Promise<ActionTaskRecord>;
  reconcile(id: string): Promise<ActionTaskRecord>;
  undo(id: string): Promise<ActionTaskRecord>;
}
