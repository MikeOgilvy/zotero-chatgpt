import type { ManagedProcess, ProcessPort, ProcessSpec } from '../../../contracts/src/runtime.ts';
export interface RawPipe { read(): Promise<ArrayBuffer> }
export interface NativeProcess {
  stdin: { write(chunk: string): Promise<number>; close(): Promise<void> };
  stdout: RawPipe; stderr: RawPipe;
  wait(): Promise<{ exitCode: number | null }>;
  kill(timeoutMs: number): Promise<unknown>;
}
export interface SubprocessAPI {
  call(options: { command: string; arguments: string[]; workdir: string; environment: Record<string, string>; environmentAppend: false; stderr: 'pipe' }): Promise<NativeProcess>;
}
export async function* decodeStdout(pipe: RawPipe): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const bytes = await pipe.read();
      if (bytes.byteLength === 0) { const tail = decoder.decode(); if (tail) yield tail; return; }
      const text = decoder.decode(bytes, { stream: true }); if (text) yield text;
    }
  } catch { throw new Error('Codex output stream failed'); }
}
export class GeckoProcessPort implements ProcessPort {
  constructor(private subprocess: SubprocessAPI, private graceMs = 500) {}
  async spawn(spec: ProcessSpec): Promise<ManagedProcess> {
    let native: NativeProcess;
    try {
      native = await this.subprocess.call({ command: spec.executable, arguments: [...spec.args], workdir: spec.cwd, environment: { ...spec.env }, environmentAppend: false, stderr: 'pipe' });
    } catch { throw new Error('Unable to start bundled Codex'); }
    const exit = native.wait().catch(() => { throw new Error('Codex process wait failed'); });
    // Register a rejection handler even before the protocol consumer calls wait().
    void exit.catch(() => undefined);
    let stopping: Promise<void> | null = null;
    const terminate = (): Promise<void> => {
      if (stopping) return stopping;
      stopping = (async () => {
        void native.stdin.close().catch(() => undefined);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const exited = await Promise.race([
          exit.then(() => true, () => false),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), this.graceMs); }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        if (!exited) { try { await native.kill(this.graceMs); } catch { throw new Error('Unable to stop owned Codex process'); } }
        await exit;
      })();
      return stopping;
    };
    // Never decode, retain or log stderr: it can contain authentication material.
    void (async () => { while ((await native.stderr.read()).byteLength !== 0) { /* drain */ } })().catch(() => { void terminate().catch(() => undefined); });
    return {
      stdout: decodeStdout(native.stdout),
      writeStdin: async chunk => { try { await native.stdin.write(chunk); } catch { throw new Error('Codex input stream failed'); } },
      wait: () => exit,
      terminate,
    };
  }
}
