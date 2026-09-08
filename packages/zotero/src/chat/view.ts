export interface AttachmentIdentity { title: string; key: string; libraryID: number }
const HTML = 'http://www.w3.org/1999/xhtml';
/** S1 has no account or transport. All text here describes that observable state. */
export function renderPreview(body: HTMLElement, identity: AttachmentIdentity, close: () => void): void {
  const doc = body.ownerDocument;
  const element = (tag: string, text: string, className?: string) => {
    const node = doc.createElementNS(HTML, tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = element('section', '', 'zcr-sidebar');
  root.dataset.zcrSidebar = '';
  root.setAttribute('aria-label', 'Codex development preview');
  root.dataset.attachmentKey = identity.key;
  root.dataset.libraryId = String(identity.libraryID);
  const header = element('header', '');
  header.append(element('strong', 'Codex'));
  const closeButton = element('button', '×') as HTMLButtonElement;
  closeButton.type = 'button'; closeButton.title = 'Close Codex sidebar';
  closeButton.setAttribute('aria-label', closeButton.title);
  closeButton.addEventListener('click', close);
  header.append(closeButton);
  const title = element('h2', identity.title || 'PDF attachment');
  const identityLine = element('p', `Library ${identity.libraryID} · Attachment ${identity.key}`, 'zcr-identity');
  const status = element('div', '', 'zcr-status');
  status.append(element('strong', 'Development preview'), element('p', 'No model connected. Login and messaging are not available in this version.'));
  const footer = element('footer', 'This preview tests the native dock and PDF layout.');
  root.append(header, title, identityLine, status, footer);
  body.replaceChildren(root);
}
