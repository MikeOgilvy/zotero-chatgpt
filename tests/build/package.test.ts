import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
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

async function createPackagingFixture(parentDirectory: string): Promise<{
  expectedFiles: Map<string, Buffer>;
  sourceDirectory: string;
}> {
  const sourceDirectory = path.join(parentDirectory, "package-source");
  await Promise.all([
    mkdir(path.join(sourceDirectory, "content/assets"), { recursive: true }),
    mkdir(path.join(sourceDirectory, "locale/en-US"), { recursive: true }),
    mkdir(path.join(sourceDirectory, "docs"), { recursive: true }),
  ]);

  const requiredFiles = ["bootstrap.js", "content/zcr.js", "manifest.json"];
  await Promise.all(
    requiredFiles.map(async (file) => {
      const destination = path.join(sourceDirectory, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(builtExtension, file), destination);
    }),
  );
  await Promise.all([
    writeFile(path.join(sourceDirectory, "content/assets/example.css"), "body {}\n"),
    writeFile(
      path.join(sourceDirectory, "locale/en-US/example.ftl"),
      "example-label = Example\n",
    ),
    writeFile(
      path.join(sourceDirectory, "docs/private-notes.txt"),
      "must not be packaged\n",
    ),
  ]);

  const packagedFiles = [
    "bootstrap.js",
    "content/assets/example.css",
    "content/zcr.js",
    "locale/en-US/example.ftl",
    "manifest.json",
  ];
  const expectedFiles = new Map(
    await Promise.all(
      packagedFiles.map(async (file) => [
        file,
        await readFile(path.join(sourceDirectory, file)),
      ] as const),
    ),
  );
  return { expectedFiles, sourceDirectory };
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
  it("preserves allowed runtime files and excludes unrelated files", async () => {
    const outputDirectory = await makeTemporaryDirectory();
    const archivePath = path.join(outputDirectory, "extension.xpi");
    const { expectedFiles, sourceDirectory } =
      await createPackagingFixture(outputDirectory);

    await execFileAsync(
      process.execPath,
      [
        "scripts/package.mjs",
        "--source",
        sourceDirectory,
        "--output",
        archivePath,
      ],
      { cwd: repositoryRoot },
    );

    const entries = await readArchive(archivePath);
    expect(entries.map(({ name }) => name).sort()).toEqual(
      [...expectedFiles.keys()].sort(),
    );
    for (const { name, contents } of entries) {
      expect(contents.equals(expectedFiles.get(name)!), `${name} contents`).toBe(
        true,
      );
    }
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

  it("rejects a manifest missing Zotero's required update URL", async () => {
    const testDirectory = await makeTemporaryDirectory();
    const incompleteBuild = path.join(testDirectory, "incomplete-manifest");
    await cp(builtExtension, incompleteBuild, { recursive: true });
    const manifestPath = path.join(incompleteBuild, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      applications: { zotero: { update_url?: string } };
    };
    delete manifest.applications.zotero.update_url;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let stderr = "";
    try {
      await execFileAsync(
        process.execPath,
        [
          "scripts/package.mjs",
          "--source",
          incompleteBuild,
          "--output",
          path.join(testDirectory, "invalid-manifest.xpi"),
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

    expect(stderr).toContain(
      "Missing required Zotero manifest field: applications.zotero.update_url",
    );
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

  it("produces byte-identical archives across process timezones", async () => {
    const outputDirectory = await makeTemporaryDirectory();
    const utcArchive = path.join(outputDirectory, "utc.xpi");
    const shanghaiArchive = path.join(outputDirectory, "shanghai.xpi");
    const packageInTimezone = async (timezone: string, archivePath: string) => {
      await execFileAsync(
        process.execPath,
        ["scripts/package.mjs", "--source", builtExtension, "--output", archivePath],
        {
          cwd: repositoryRoot,
          env: { ...process.env, TZ: timezone },
        },
      );
    };

    await packageInTimezone("UTC", utcArchive);
    await packageInTimezone("Asia/Shanghai", shanghaiArchive);

    expect((await readFile(utcArchive)).equals(await readFile(shanghaiArchive))).toBe(
      true,
    );
  });
});
