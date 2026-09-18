import type { DocumentRevision, PaperScope } from './index.ts';
import type { NativeAcquisitionResult, NativeAnnotationSnapshot, NativeCollectionAddition, NativeCollectionTarget, NativeItemSnapshot, NativeMetadataPreview, NativeQuoteResolution } from './native.ts';

export interface AnnotationProposal { quote: string; pageIndex: number; reason: string }
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
