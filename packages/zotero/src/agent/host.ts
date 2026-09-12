import type { DocumentRevision } from '../../../contracts/src/index.ts';
import type { HostReader } from '../reader/host-types.ts';

/** Private Zotero 9.0.6 surfaces. Keep native details out of contracts/core. */
export interface AgentHostItem {
  id: number;
  key: string;
  libraryID: number;
  parentID: number | false | null;
  deleted?: boolean;
  itemType: string;
  dateModified: string;
  annotationType: string;
  annotationText: string | null;
  annotationComment: string | null;
  annotationColor: string | null;
  annotationPageLabel: string | null;
  annotationSortIndex: string | null;
  annotationPosition: string | null;
  annotationAuthorName: string | null;
  annotationIsExternal: boolean;
  attachmentContentType: string;
  isAnnotation(): boolean;
  isRegularItem(): boolean;
  isPDFAttachment(): boolean;
  isEditable(operation?: 'edit' | 'erase'): boolean;
  getField(field: string): string;
  getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string; fieldMode?: number }>;
  getCreatorsJSON(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>;
  getExtraField?(field: string): string | false;
  getTags(): Array<{ tag: string }>;
  getCollections(includeTrashed?: boolean): number[];
  getAttachments(includeTrashed?: boolean): number[];
  getNotes(includeTrashed?: boolean): number[];
  getAnnotations(): AgentHostItem[];
  toJSON(): object;
  getFilePathAsync(): Promise<string | false>;
  fromJSON(json: object): void;
  loadPrimaryData(): Promise<void>;
  addToCollection(key: string): void;
  removeFromCollection(key: string): void;
  loadAllData?(): Promise<void>;
  save(options?: { skipSelect?: boolean }): Promise<number | boolean>;
  erase(): Promise<void>;
}
export interface AgentHostCollection { id: number; key: string; libraryID: number; deleted?: boolean; isEditable(): boolean }
interface TranslatorBase {
  getTranslators(): Promise<Array<{ translatorID: string }>>;
  setTranslator(translator: Array<{ translatorID: string }> | { translatorID: string }): void;
  setUserContextId(id: number): void;
  setHandler(type: string, callback: (object: unknown, items: Record<string, string>, done: (selected: Record<string, string>) => void) => void): void;
  translate(options: { libraryID: false; saveAttachments: false }): Promise<unknown[]>;
}
export interface AgentHostSearchTranslator extends TranslatorBase { setIdentifier(identifier: object): void }
export interface AgentHostWebTranslator extends TranslatorBase { setDocument(doc: Document): void }
export interface AgentHTTPOptions {
  responseType?: string;
  anon?: boolean;
  timeout?: number;
  errorDelayMax?: number;
  followRedirects?: boolean;
  numRedirects?: number;
  cancellerReceiver?: (cancel: () => void) => void;
}
export interface AgentHTTPResponse { response: unknown; status: number; responseURL: string; getResponseHeader?(name: string): string | null }
export interface NativeAgentHost {
  Item: new (itemType: string) => AgentHostItem;
  Items: {
    getByLibraryAndKey(libraryID: number, key: string): AgentHostItem | false | undefined;
    get(id: number): AgentHostItem | false | undefined;
    getAsync(id: number): Promise<AgentHostItem>;
  };
  Collections: {
    getByLibraryAndKey(libraryID: number, key: string): AgentHostCollection | false | undefined;
    get(id: number): AgentHostCollection | false | undefined;
  };
  Libraries: { get(id: number): { editable: boolean; filesEditable: boolean } | undefined };
  DB: { executeTransaction<T>(callback: () => Promise<T>): Promise<T> };
  Annotations: { saveFromJSON(attachment: AgentHostItem, json: object, options?: { skipSelect?: boolean }): Promise<AgentHostItem> };
  Search: new () => { libraryID: number; addCondition(condition: string, operator: string, value?: string): void; search(): Promise<number[]> };
  Reader: { _readers: HostReader[] };
  Utilities: {
    cleanDOI(value: string): string | false;
    extractIdentifiers(value: string): Array<Record<string, string>>;
    Internal: { getOpenAccessPDFURLs(doi: string, options: { timeout: number }): Promise<Array<{ url?: string; pageURL?: string; version?: string }>> };
  };
  Translate: { Search: new () => AgentHostSearchTranslator; Web: new () => AgentHostWebTranslator };
  HTTP: {
    newCookieContext(): { id: number; dispose(): void };
    request(method: string, url: string, options: AgentHTTPOptions): Promise<AgentHTTPResponse>;
    download(url: string, path: string, options: AgentHTTPOptions): Promise<AgentHTTPResponse>;
  };
  MIME: { getMIMETypeFromFile(path: string): Promise<string> };
  Attachments: {
    createTemporaryStorageDirectory(): Promise<{ path: string }>;
    createURLAttachmentFromTemporaryStorageDirectory(options: { directory: string; filename: string; libraryID: number; parentItemID: number; title: string; url: string; contentType: string; saveOptions: { skipSelect: true } }): Promise<AgentHostItem>;
  };
  PDFWorker: {
    _enqueue<T>(callback: () => Promise<T>, isPriority: boolean): Promise<T>;
    _query(action: string, data: { buf: ArrayBuffer; maxPages: number }, transfer: ArrayBuffer[]): Promise<unknown>;
  };
}
export interface AgentEnvironment {
  join(...parts: string[]): string;
  stat(path: string): Promise<{ size: number }>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string, options: { recursive: true; ignoreAbsent: true }): Promise<void>;
  computeHexDigest(path: string, algorithm: 'sha256'): Promise<string>;
}
export interface AgentPageChar {
  c: string;
  rect: number[];
  inlineRect: number[];
  offset?: number;
  ignorable?: boolean;
  isolated?: boolean;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
}
export interface AgentDocumentSource {
  revision: DocumentRevision;
  pdf: {
    numPages: number;
    getPageLabels2(): Promise<string[] | null>;
    getPageData(options: { pageIndex: number }): Promise<{ chars: AgentPageChar[]; viewBox: number[]; partial?: boolean }>;
  };
}
