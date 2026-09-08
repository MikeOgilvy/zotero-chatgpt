export interface PaperScope {
  clientId: string;
  libraryId: number;
  attachmentKey: string;
}

export function paperId(paper: PaperScope): string {
  return JSON.stringify([paper.clientId, paper.libraryId, paper.attachmentKey]);
}
