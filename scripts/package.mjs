import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import yazl from "yazl";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const defaultSourceDirectory = path.join(repositoryRoot, "build/dev");
const defaultArchivePath = path.join(
  repositoryRoot,
  "dist/zotero-codex-reader-0.1.0a1-dev.xpi",
);
const requiredFiles = ["bootstrap.js", "content/zcr.js", "manifest.json"];
const requiredManifestFields = [
  ["name"],
  ["version"],
  ["applications", "zotero", "id"],
  ["applications", "zotero", "strict_min_version"],
  ["applications", "zotero", "strict_max_version"],
  ["applications", "zotero", "update_url"],
];
const fixedLocalTimestamp = new Date(1980, 0, 1, 0, 0, 0, 0);

function requireNode24() {
  if (process.versions.node.split(".")[0] !== "24") {
    throw new Error(`Node 24 is required; found ${process.versions.node}`);
  }
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return path.resolve(value);
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(filePath, archivePath)));
    } else if (entry.isFile()) {
      files.push(archivePath);
    }
  }
  return files;
}

function isRuntimeFile(filePath) {
  return (
    filePath === "bootstrap.js" ||
    filePath === "manifest.json" ||
    filePath.startsWith("content/") ||
    filePath.startsWith("locale/") ||
    filePath.startsWith("locales/")
  );
}

async function validateRequiredFiles(sourceDirectory) {
  for (const requiredFile of requiredFiles) {
    const filePath = path.join(sourceDirectory, requiredFile);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error(`Missing required runtime file: ${requiredFile}`);
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        throw new Error(`Missing required runtime file: ${requiredFile}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

function nestedValue(object, pathSegments) {
  let value = object;
  for (const segment of pathSegments) {
    if (!value || typeof value !== "object" || !(segment in value)) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

async function validateManifest(sourceDirectory) {
  const manifestPath = path.join(sourceDirectory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error("Invalid Zotero manifest JSON", { cause: error });
  }

  for (const fieldPath of requiredManifestFields) {
    const value = nestedValue(manifest, fieldPath);
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Missing required Zotero manifest field: ${fieldPath.join(".")}`,
      );
    }
  }
}

async function writeArchive(sourceDirectory, archivePath, files) {
  await mkdir(path.dirname(archivePath), { recursive: true });
  const zipFile = new yazl.ZipFile();
  const output = createWriteStream(archivePath, { flags: "w" });
  const completion = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zipFile.outputStream.on("error", reject);
  });

  zipFile.outputStream.pipe(output);
  for (const file of files) {
    zipFile.addBuffer(await readFile(path.join(sourceDirectory, file)), file, {
      mode: 0o100644,
      mtime: fixedLocalTimestamp,
      forceDosTimestamp: true,
    });
  }
  zipFile.end();
  await completion;
}

async function main() {
  requireNode24();
  const sourceDirectory = readOption("--source", defaultSourceDirectory);
  const archivePath = readOption("--output", defaultArchivePath);
  await validateRequiredFiles(sourceDirectory);
  await validateManifest(sourceDirectory);
  const files = (await listFiles(sourceDirectory)).filter(isRuntimeFile).sort();
  await writeArchive(sourceDirectory, archivePath, files);
  console.log(`Packaged development XPI at ${archivePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
