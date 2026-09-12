import type { DocumentRevision, PaperScope } from './index.ts';
import type { NativeAcquisitionResult, NativeAnnotationSnapshot, NativeCollectionAddition, NativeCollectionTarget, NativeItemSnapshot, NativeMetadataPreview, NativeQuoteResolution } from './agent.ts';

export interface AnnotationProposal { quote: string; pageIndex: number; reason: string }
export type AgentTaskState = 'preparing' | 'review' | 'running' | 'completed' | 'partial' | 'cancelled' | 'uncertain' | 'undone' | 'conflict' | 'failed';
export type AgentTaskItemStatus = 'candidate' | 'unresolved' | 'skipped' | 'writing' | 'applied' | 'metadata-only' | 'failed' | 'uncertain' | 'undoing' | 'undone' | 'conflict';
export type AgentTaskOperation = 'annotation-create' | 'metadata-create' | 'collection-add' | 'pdf-acquire' | 'annotation-delete' | 'collection-remove' | 'item-trash' | 'attachment-trash';
interface TaskItemBase {
  id: string;
  reservedKey: string;
  status: AgentTaskItemStatus;
  operation?: AgentTaskOperation;
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
export type AgentTaskChoices = Record<string, AcquisitionChoice>;
interface AgentTaskBase {
  schemaVersion: 1;
  id: string;
  conversationId: string;
  question: string;
  state: AgentTaskState;
  createdAt: string;
  updatedAt: string;
  revision: number;
  approvedAt?: string;
  cancelRequested?: true;
}
export type AgentTaskRecord =
  | (AgentTaskBase & { kind: 'annotations'; paper: PaperScope; documentRevision: DocumentRevision; modelRequestId?: string; items: AnnotationTaskItem[] })
  | (AgentTaskBase & { kind: 'acquisition'; target: NativeCollectionTarget; items: AcquisitionTaskItem[] });
export interface AnnotationTaskPlan { conversationId: string; paper: PaperScope; revision: DocumentRevision; question: string; modelRequestId?: string; candidates: AnnotationProposal[] }
export interface AcquisitionTaskPlan { conversationId: string; target: NativeCollectionTarget; question: string; identifiers: string[] }
export interface AgentTasks {
  list(conversationId?: string): Promise<AgentTaskRecord[]>;
  get(id: string): Promise<AgentTaskRecord>;
  subscribe(listener: (record: AgentTaskRecord) => void): () => void;
  planAnnotations(input: AnnotationTaskPlan): Promise<AgentTaskRecord>;
  planAcquisition(input: AcquisitionTaskPlan): Promise<AgentTaskRecord>;
  approve(id: string, selectedItemIds: string[], choices?: AgentTaskChoices): Promise<AgentTaskRecord>;
  cancel(id: string): Promise<AgentTaskRecord>;
  reconcile(id: string): Promise<AgentTaskRecord>;
  undo(id: string): Promise<AgentTaskRecord>;
}
