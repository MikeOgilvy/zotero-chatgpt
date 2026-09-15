import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import yazl from "yazl";
import { PINNED_RUNTIME, validatePackagedRuntime } from "./runtime-assets.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const defaultSourceDirectory = path.join(repositoryRoot, "build/dev");
const requiredFiles = ["bootstrap.js", "content/zcr.js", "manifest.json", "LICENSE"];
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

function isRuntimeFile(filePath, runtimeManifest) {
  if (filePath.startsWith("content/runtime/")) return [runtimeManifest.entry, "content/runtime/manifest.json", ...runtimeManifest.licenses.map(name => "content/runtime/licenses/" + name)].includes(filePath);
  return (
    filePath === "bootstrap.js" ||
    filePath === "manifest.json" ||
    filePath === "LICENSE" ||
    filePath.startsWith("content/") ||
    filePath.startsWith("locale/")
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
  return manifest;
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
    zipFile.addFile(path.join(sourceDirectory, file), file, {
      mode: 0o100644,
      mtime: fixedLocalTimestamp,
      forceDosTimestamp: true,
    });
  }
  zipFile.end();
  await completion;
}

export async function packageExtension(sourceDirectory = defaultSourceDirectory, requestedArchivePath, options = {}) {
  requireNode24();
  await validateRequiredFiles(sourceDirectory);
  const manifest = await validateManifest(sourceDirectory);
  const runtimeManifest = options.runtimeManifest ?? PINNED_RUNTIME;
  await validatePackagedRuntime(sourceDirectory, runtimeManifest);
  const archivePath = requestedArchivePath ?? path.join(options.repositoryRoot ?? repositoryRoot, `dist/zotero-codex-reader-${manifest.version}-dev.xpi`);
  const files = (await listFiles(sourceDirectory)).filter(file => isRuntimeFile(file, runtimeManifest)).sort();
  await writeArchive(sourceDirectory, archivePath, files);
  const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  await writeFile(path.join(path.dirname(archivePath), "SHA256SUMS"), `${digest}  ${path.basename(archivePath)}\n`);
  return archivePath;
}
async function main() {
  const archivePath = await packageExtension(readOption("--source", defaultSourceDirectory), readOption("--output", undefined));
  console.log(`Packaged development XPI at ${archivePath}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
