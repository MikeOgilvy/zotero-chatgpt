import type { RuntimeHost } from './prepare.ts';
import type { FileAPI } from './storage.ts';
import type { SubprocessAPI } from './process.ts';
interface NativeFile { initWithPath(path: string): void; isSymlink(): boolean }
declare const ChromeUtils: { importESModule(uri: string): { Subprocess: SubprocessAPI } };
declare const IOUtils: FileAPI;
declare const PathUtils: { profileDir: string; join(...parts: string[]): string };
declare const Services: { appinfo: { OS: string; XPCOMABI: string }; env: { get(name: string): string } };
declare const Cc: Record<string, { createInstance(iface: unknown): NativeFile }>;
declare const Ci: { nsIFile: unknown };
export function geckoHost(): { host: RuntimeHost; subprocess: SubprocessAPI } {
  const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
  return {
    subprocess: Subprocess,
    host: {
      io: IOUtils,
      join: (...parts) => PathUtils.join(...parts),
      profileDir: PathUtils.profileDir,
      os: Services.appinfo.OS,
      abi: Services.appinfo.XPCOMABI,
      findSystemCodex: async () => {
        if (Services.appinfo.OS !== 'Linux' || !/^(x86_64|x64|amd64)-/u.test(Services.appinfo.XPCOMABI)) return null;
        const getEnv = (name: string): string => { try { return Services.env.get(name) || ''; } catch { return ''; } };
        const home = getEnv('HOME');
        const pathEntries = getEnv('PATH').split(':').filter(Boolean);
        const candidates = [getEnv('CODEX_CLI_PATH'), home ? PathUtils.join(home, '.local', 'bin', 'codex') : '', ...pathEntries.map(directory => PathUtils.join(directory, 'codex'))].filter(Boolean);
        for (const executable of [...new Set(candidates)]) {
          try {
            if (!await IOUtils.exists(executable) || (await IOUtils.stat(executable)).type !== 'regular') continue;
            return { executable, home: home || PathUtils.profileDir };
          } catch { /* Keep searching candidates that are absent or inaccessible. */ }
        }
        return null;
      },
      copySystemCodexAuth: async targetCodexHome => {
        const home = (() => { try { return Services.env.get('HOME') || ''; } catch { return ''; } })();
        if (!home) throw new Error('HOME is unavailable');
        const source = PathUtils.join(home, '.codex', 'auth.json');
        if (!await IOUtils.exists(source) || (await IOUtils.stat(source)).type !== 'regular') throw new Error('Codex login credentials are unavailable');
        const bytes = await IOUtils.read(source);
        const target = PathUtils.join(targetCodexHome, 'auth.json');
        await IOUtils.write(target, bytes, { mode: 'overwrite', flush: true });
        await IOUtils.setPermissions(target, 0o600, false);
      },
      uuid: () => crypto.randomUUID(),
      isSymlink: path => {
        const file = Cc['@mozilla.org/file/local;1']!.createInstance(Ci.nsIFile); file.initWithPath(path);
        try { return file.isSymlink(); }
        catch (error) {
          if (error && typeof error === 'object' && 'name' in error && (error.name === 'NS_ERROR_FILE_NOT_FOUND' || error.name === 'NS_ERROR_FILE_TARGET_DOES_NOT_EXIST')) return false;
          throw new Error('Unable to verify private file path');
        }
      },
      load: async url => {
        const response = await fetch(url); if (!response.ok) throw new Error('Bundled resource unavailable');
        return new Uint8Array(await response.arrayBuffer());
      },
    },
  };
}
