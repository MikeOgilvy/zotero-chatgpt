import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "zcr-build-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("development build", () => {
  it("creates a loadable Zotero global and copies required root files", async () => {
    const outputDirectory = await makeTemporaryDirectory();

    await execFileAsync(
      process.execPath,
      ["scripts/build.mjs", "--outdir", outputDirectory],
      { cwd: repositoryRoot },
    );

    const [bundle, manifest, bootstrap] = await Promise.all([
      readFile(path.join(outputDirectory, "content/zcr.js"), "utf8"),
      readFile(path.join(outputDirectory, "manifest.json"), "utf8"),
      readFile(path.join(outputDirectory, "bootstrap.js"), "utf8"),
    ]);
    const moduleScope: Record<string, unknown> = {};
    vm.createContext(moduleScope);
    vm.runInContext(bundle, moduleScope);

    expect(moduleScope.ZoteroCodexReader).toBeTypeOf("object");
    const api = moduleScope.ZoteroCodexReader as Record<string, unknown>;
    for (const method of [
      "onMainWindowLoad",
      "onMainWindowUnload",
      "shutdown",
      "startup",
    ]) {
      expect(api[method], method).toBeTypeOf("function");
    }

    const parsedManifest = JSON.parse(manifest) as { version?: unknown };
    const sourceManifest = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "packages/zotero/manifest.json"),
        "utf8",
      ),
    ) as { version?: unknown };
    expect(parsedManifest).toMatchObject({
      applications: {
        zotero: {
          id: "{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}",
          strict_max_version: "9.0.*",
          strict_min_version: "9.0.6",
        },
      },
      name: "Zotero Codex Reader (Development)",
    });
    expect(parsedManifest.version).toBe(sourceManifest.version);
    expect(bootstrap.length).toBeGreaterThan(0);
  });
});
