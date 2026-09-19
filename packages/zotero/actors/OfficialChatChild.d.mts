export class ZoteroChatGPTOfficialChatChild {
  document: any;
  contentWindow: any;
  inFlight: boolean;
  sendQuery(name: string, data?: unknown): Promise<unknown>;
  sendAsyncMessage(name: string, data?: unknown): void;
  handleEvent(event: unknown): void;
  receiveMessage(message: { name: string; data?: unknown }): Promise<{ status: string; reason?: string }>;
  submitQuestion(question: string): Promise<{ status: string; reason?: string }>;
}
