import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import yauzl from "yauzl";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];
let builtExtension: string;

interface ArchiveEntry {
  name: string;
  contents: Buffer;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "zcr-package-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function readArchive(filePath: string): Promise<ArchiveEntry[]> {
  const zipFile = await yauzl.openPromise(filePath);
  const entries: ArchiveEntry[] = [];

  for await (const entry of zipFile.eachEntry()) {
    if (entry.fileName.endsWith("/")) {
      continue;
    }

    const chunks: Buffer[] = [];
    const stream = await zipFile.openReadStreamPromise(entry);
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    entries.push({ name: entry.fileName, contents: Buffer.concat(chunks) });
  }

  return entries;
}

beforeAll(async () => {
  builtExtension = await makeTemporaryDirectory();
  await execFileAsync(
    process.execPath,
    ["scripts/build.mjs", "--outdir", builtExtension],
    { cwd: repositoryRoot },
  );
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

afterEach(async () => {
  const directories = temporaryDirectories.splice(1);
  await Promise.all(
    directories.map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("development XPI packaging", () => {
  it("packages only the required runtime files with their real contents", async () => {
    const outputDirectory = await makeTemporaryDirectory();
    const archivePath = path.join(outputDirectory, "extension.xpi");

    await execFileAsync(
      process.execPath,
      [
        "scripts/package.mjs",
        "--source",
        builtExtension,
        "--output",
        archivePath,
      ],
      { cwd: repositoryRoot },
    );

    const entries = await readArchive(archivePath);
    expect(entries.map(({ name }) => name).sort()).toEqual([
      "bootstrap.js",
      "content/zcr.js",
      "manifest.json",
    ]);
    await Promise.all(
      entries.map(async ({ name, contents }) => {
        const builtContents = await readFile(path.join(builtExtension, name));
        expect(contents.equals(builtContents), `${name} contents`).toBe(true);
      }),
    );
  });

  it("rejects a build missing a required runtime file", async () => {
    const testDirectory = await makeTemporaryDirectory();
    const incompleteBuild = path.join(testDirectory, "incomplete");
    await cp(builtExtension, incompleteBuild, { recursive: true });
    await rm(path.join(incompleteBuild, "bootstrap.js"));

    let stderr = "";
    try {
      await execFileAsync(
        process.execPath,
        [
          "scripts/package.mjs",
          "--source",
          incompleteBuild,
          "--output",
          path.join(testDirectory, "invalid.xpi"),
        ],
        { cwd: repositoryRoot },
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "stderr" in error &&
        typeof error.stderr === "string"
      ) {
        stderr = error.stderr;
      } else {
        throw error;
      }
    }

    expect(stderr).toContain("Missing required runtime file: bootstrap.js");
  });

  it("produces byte-identical archives from unchanged input", async () => {
    const outputDirectory = await makeTemporaryDirectory();
    const firstArchive = path.join(outputDirectory, "first.xpi");
    const secondArchive = path.join(outputDirectory, "second.xpi");

    await execFileAsync(
      process.execPath,
      ["scripts/package.mjs", "--source", builtExtension, "--output", firstArchive],
      { cwd: repositoryRoot },
    );
    await writeFile(path.join(builtExtension, "timestamp-noise"), new Date().toISOString());
    await execFileAsync(
      process.execPath,
      ["scripts/package.mjs", "--source", builtExtension, "--output", secondArchive],
      { cwd: repositoryRoot },
    );

    const digest = (contents: Buffer): string =>
      createHash("sha256").update(contents).digest("hex");
    expect(digest(await readFile(secondArchive))).toBe(
      digest(await readFile(firstArchive)),
    );
  });
});
