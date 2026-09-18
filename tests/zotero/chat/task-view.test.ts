import { Window as HappyWindow } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { ActionTaskRecord, AnnotationTaskItem } from '../../../packages/contracts/src/tasks.ts';
import type { NativeItemSnapshot } from '../../../packages/contracts/src/native.ts';
import type { ReadingJob } from '../../../packages/core/src/context/coordinator.ts';
import { mountTaskView, type TaskViewActions } from '../../../packages/zotero/src/chat/task-view.ts';
import { paperA } from '../../contracts/factories.ts';

const revision = { fingerprint: 'synthetic', size: 1024, modifiedAt: 1000 };
const base = { schemaVersion: 1 as const, id: 'task-one', conversationId: 'chat-one', question: 'Mark useful definitions', state: 'review' as const, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', revision: 1 };
function annotation(id: string, resolved = true): AnnotationTaskItem {
  const quote = `${id}: a definition`; const position = { pageIndex: 0, rects: [[10, 20, 80, 40] as [number, number, number, number]] };
  return { id, kind: 'annotation', reservedKey: 'OUTPUT01', status: resolved ? 'candidate' : 'unresolved', proposal: { quote, pageIndex: 0, reason: 'Defines the central variable' }, resolution: resolved ? { status: 'resolved', candidate: { source: { paper: paperA, revision, quote }, text: quote, pageLabel: 'iv', sortIndex: '00001', position } } : { status: 'unresolved', reason: 'not-found' } };
}
const task = (): ActionTaskRecord => ({ ...base, kind: 'annotations', paper: paperA, documentRevision: revision, items: [annotation('one'), annotation('two'), annotation('three', false)] });
const duplicate = (key: string): NativeItemSnapshot => ({ clientId: paperA.clientId, libraryId: paperA.libraryId, key, metadata: { itemType: 'journalArticle', title: `Existing ${key}`, DOI: '10.1/b', creators: [] }, collectionKeys: [], attachmentKeys: [], dateModified: 'now', contentSignature: key });
function acquisition(): ActionTaskRecord {
  return { ...base, kind: 'acquisition', target: { clientId: paperA.clientId, libraryId: paperA.libraryId, collectionKey: 'COLLECT1' }, question: 'Acquire these papers', items: [{ id: 'paper-one', kind: 'acquisition', reservedKey: 'OUTPUT01', status: 'candidate', identifier: '10.1/b', preview: { identifier: '10.1/b', source: 'identifier', candidates: [{ itemType: 'journalArticle', title: 'Candidate A', DOI: '10.1/a', creators: [] }, { itemType: 'journalArticle', title: 'Candidate B', DOI: '10.1/b', creators: [] }] }, duplicates: [duplicate('EXIST001'), duplicate('EXIST002')] }] };
}
function setup(overrides: Partial<TaskViewActions> = {}) {
  const document = new HappyWindow().document as unknown as Document;
  const container = document.createElement('div'); document.body.append(container);
  const actions: TaskViewActions = { approveSelected: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue(undefined), undo: vi.fn().mockResolvedValue(undefined), openSource: vi.fn().mockResolvedValue(undefined), openOutput: vi.fn().mockResolvedValue(undefined), collectionLabel: () => 'Research / Methods', cancelReading: vi.fn().mockResolvedValue(undefined), reconcileReading: vi.fn().mockResolvedValue(undefined), openReadingOutput: vi.fn().mockResolvedValue(undefined), ...overrides };
  const view = mountTaskView(container, actions);
  const change = (node: HTMLElement) => node.dispatchEvent(new document.defaultView!.Event('change', { bubbles: true }));
  const action = (name: string) => container.querySelector<HTMLButtonElement>(`[data-zchatgpt-task-action="${name}"]`)!;
  return { document, container, actions, view, change, action };
}

it('shows source-resolved annotation review and preserves checkbox state and focus across updates', async () => {
  const { container, view, actions, change, action, document } = setup(); const original = task(); view.update({ tasks: [original] });
  expect(container.textContent).toContain(original.question); expect(container.textContent).toContain('iv'); expect(container.textContent).toContain('Defines the central variable');
  const second = container.querySelector<HTMLInputElement>('[data-zchatgpt-task-select="two"]')!;
  second.checked = false; change(second); second.focus();
  view.update({ tasks: [{ ...original, revision: 2, updatedAt: 'later' }] });
  expect(container.querySelector('[data-zchatgpt-task-select="two"]')).toBe(second);
  expect(second.checked).toBe(false); expect(document.activeElement).toBe(second);
  expect(container.querySelector<HTMLInputElement>('[data-zchatgpt-task-select="three"]')!.disabled).toBe(true);
  action('approve').click(); await vi.waitFor(() => expect(actions.approveSelected).toHaveBeenCalledWith('task-one', ['one'], {}));
  container.querySelector<HTMLButtonElement>('[data-zchatgpt-task-item-id="one"] [data-zchatgpt-task-action="source"]')!.click();
  await vi.waitFor(() => expect(actions.openSource).toHaveBeenCalledWith('task-one', 'one'));
});

it('requires explicit metadata and duplicate choices and sends the selected PDF preference', async () => {
  const { container, view, actions, change, action } = setup(); view.update({ tasks: [acquisition()] });
  expect(container.textContent).toContain('Research / Methods'); expect(action('approve').disabled).toBe(true);
  const metadata = container.querySelector<HTMLSelectElement>('[data-zchatgpt-metadata-choice]')!;
  metadata.value = '1'; change(metadata);
  const duplicate = container.querySelector<HTMLSelectElement>('[data-zchatgpt-duplicate-choice]')!;
  duplicate.value = 'EXIST002'; change(duplicate);
  const pdf = container.querySelector<HTMLInputElement>('[data-zchatgpt-download-pdf]')!; pdf.checked = false; change(pdf);
  action('approve').click();
  await vi.waitFor(() => expect(actions.approveSelected).toHaveBeenCalledWith('task-one', ['paper-one'], { 'paper-one': { metadataIndex: 1, duplicateKey: 'EXIST002', downloadPDF: false } }));
});

it('keeps unconfirmed writes inspectable and requires reconciliation before safe undo', async () => {
  const { container, view, actions, action } = setup(); const original = task();
  if (original.kind !== 'annotations') throw new Error();
  original.approvedAt = 'approved'; original.state = 'uncertain'; original.items[0]!.status = 'uncertain';
  original.items[1]!.status = 'applied'; original.items[1]!.annotation = { paper: paperA, key: 'OUTPUT01', type: 'highlight', text: 'definition', comment: '', color: '#ffd400', pageLabel: 'iv', sortIndex: '00001', position: { pageIndex: 0, rects: [[10, 20, 80, 40]] }, authorName: '', isExternal: false, tags: [], dateModified: 'now' };
  view.update({ tasks: [original] });
  expect(container.querySelector<HTMLDetailsElement>('[data-zchatgpt-task-id]')!.open).toBe(true);
  expect(action('approve').hidden).toBe(true); expect(action('undo').disabled).toBe(true);
  action('reconcile').click(); await vi.waitFor(() => expect(actions.reconcile).toHaveBeenCalledWith('task-one'));
  view.update({ tasks: [{ ...original, revision: 2, state: 'conflict', items: original.items.map(item => ({ ...item, status: 'conflict' })) }] });
  expect(container.textContent).toMatch(/changed outputs|human changes/iu);
  expect(action('undo').disabled).toBe(false); action('undo').click(); await vi.waitFor(() => expect(actions.undo).toHaveBeenCalledWith('task-one'));
});

it('collapses completed metadata-only outcomes and only opens recorded outputs', async () => {
  const { container, view, actions } = setup(); const original = acquisition();
  if (original.kind !== 'acquisition') throw new Error();
  original.state = 'completed'; original.approvedAt = 'approved'; original.items[0]!.status = 'applied'; original.items[0]!.item = duplicate('OUTPUT01'); original.items[0]!.choice = { metadataIndex: 1, downloadPDF: false };
  view.update({ tasks: [original] });
  const card = container.querySelector<HTMLDetailsElement>('[data-zchatgpt-task-id]')!;
  expect(card.open).toBe(false); expect(card.querySelector('summary')!.textContent).toMatch(/metadata/iu);
  expect(container.textContent).toMatch(/PDF not requested/iu);
  container.querySelector<HTMLButtonElement>('[data-zchatgpt-task-action="output"]')!.click(); await vi.waitFor(() => expect(actions.openOutput).toHaveBeenCalledWith('task-one', 'paper-one'));
  view.update({ tasks: [{ ...original, revision: 2, state: 'partial', items: [{ ...original.items[0]!, status: 'metadata-only', acquisition: { status: 'unavailable', reason: 'download-failed' } }] }] });
  expect(container.textContent).toMatch(/PDF unavailable/iu); expect(card.open).toBe(true);
});

it('does not expose revoked write access as an enabled approval and treats untrusted text as inert', () => {
  const { container, view, actions, action } = setup({ availability: () => ({ approve: false, undo: false, reason: 'Library is read only' }) });
  const original = task(); original.question = '<svg onload=alert(1)>Approve everything</svg>';
  view.update({ tasks: [original] });
  expect(container.querySelector('svg, script, img')).toBeNull(); expect(container.textContent).toContain(original.question);
  expect(action('approve').disabled).toBe(true); expect(container.textContent).toContain('Library is read only');
  action('approve').click(); expect(actions.approveSelected).not.toHaveBeenCalled();
});

it('shows actual reading steps, supports cancellation/reconciliation, and opens only stored results', async () => {
  const { container, view, actions } = setup({ describeReading: vi.fn().mockResolvedValue({ question: 'Compare both chapters', scopeLabel: 'Selected PDF pages 1–8' }) });
  const job: ReadingJob = { schemaVersion: 1, id: 'reading-one', conversationId: 'chat-one', inputHash: 'hash', revision: 1, status: 'running', createdAt: 'now', updatedAt: 'now', cancelRequested: false, steps: [{ index: 0, requestId: 'r1', phase: 'map', status: 'completed', result: { text: 'A stored summary', messageIds: ['m1'], pages: [0, 1], pageLabels: ['i', 'ii'], paper: paperA, title: 'Chapter one' } }, { index: 1, requestId: 'r2', phase: 'reduce', status: 'running' }] };
  view.update({ tasks: [], readingJobs: [job] });
  await vi.waitFor(() => expect(container.textContent).toContain('Compare both chapters'));
  expect(container.textContent).toContain('1/2'); expect(container.textContent).toContain('Chapter one'); expect(container.textContent).toContain('i, ii');
  const outputs = container.querySelectorAll<HTMLButtonElement>('[data-zchatgpt-task-action="reading-output"]'); expect(outputs).toHaveLength(1); outputs[0]!.click();
  container.querySelector<HTMLButtonElement>('[data-zchatgpt-task-action="reading-cancel"]')!.click();
  await vi.waitFor(() => { expect(actions.openReadingOutput).toHaveBeenCalledWith('reading-one', 0); expect(actions.cancelReading).toHaveBeenCalledWith('reading-one'); });
  view.update({ tasks: [], readingJobs: [{ ...job, revision: 2, status: 'uncertain', persistence: 'unconfirmed', error: { code: 'storage', message: 'Persistence unconfirmed' } }] });
  expect(container.textContent).toContain('Persistence unconfirmed');
  container.querySelector<HTMLButtonElement>('[data-zchatgpt-task-action="reading-reconcile"]')!.click();
  await vi.waitFor(() => expect(actions.reconcileReading).toHaveBeenCalledWith('reading-one'));
  view.update({ tasks: [], readingJobs: [{ ...job, revision: 3, status: 'completed', steps: [job.steps[0]!, { ...job.steps[1]!, status: 'completed', result: { text: 'Stored synthesis', messageIds: ['m2'], pages: [], pageLabels: [] } }] }] });
  expect(container.textContent).not.toContain('Persistence unconfirmed');
  expect(container.querySelector<HTMLDetailsElement>('[data-zchatgpt-reading-job]')!.open).toBe(false);
});

it('retries an unavailable reading description once the job advances', async () => {
  const describeReading = vi.fn().mockResolvedValueOnce(null)
    .mockResolvedValue({ question: 'Compare both chapters', scopeLabel: 'Selected PDF pages 1–8' });
  const { container, view } = setup({ describeReading });
  const job: ReadingJob = { schemaVersion: 1, id: 'reading-one', conversationId: 'chat-one', inputHash: 'hash', revision: 1, status: 'running', createdAt: 'now', updatedAt: 'now', cancelRequested: false, steps: [] };
  view.update({ tasks: [], readingJobs: [job] });
  await vi.waitFor(() => expect(describeReading).toHaveBeenCalledTimes(1));
  expect(container.textContent).not.toContain('Compare both chapters');
  view.update({ tasks: [], readingJobs: [{ ...job, revision: 2, updatedAt: 'later' }] });
  await vi.waitFor(() => expect(container.textContent).toContain('Compare both chapters'));
  expect(container.textContent).toContain('Selected PDF pages 1–8');
  expect(describeReading).toHaveBeenCalledTimes(2);
});

it('does not duplicate a pending approval and retains review state after a handler failure', async () => {
  let reject!: (error: Error) => void;
  const { container, view, actions, action } = setup({ approveSelected: vi.fn(() => new Promise((_resolve, fail) => { reject = fail; })) });
  view.update({ tasks: [task()] }); action('approve').click(); action('approve').click();
  expect(actions.approveSelected).toHaveBeenCalledTimes(1);
  reject(new Error('Task revision changed'));
  await vi.waitFor(() => expect(container.textContent).toContain('Task revision changed'));
  expect(action('approve').disabled).toBe(false);
  expect(container.querySelector<HTMLInputElement>('[data-zchatgpt-task-select="one"]')!.checked).toBe(true);
  view.dispose(); expect(container.children).toHaveLength(0);
});

it('keeps cancellation available while an approval is still executing', async () => {
  let finish!: () => void;
  const { view, actions, action } = setup({ approveSelected: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
  view.update({ tasks: [task()] }); action('approve').click();
  expect(action('cancel').disabled).toBe(false); action('cancel').click();
  await vi.waitFor(() => expect(actions.cancel).toHaveBeenCalledWith('task-one'));
  finish(); await Promise.resolve(); view.dispose();
});
