import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const zoteroPackage = path.join(repositoryRoot, "packages/zotero");
const defaultOutputDirectory = path.join(repositoryRoot, "build/dev");

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

async function copyIfPresent(source, destination) {
  try {
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function copyStaticFiles(outputDirectory) {
  await Promise.all([
    cp(path.join(zoteroPackage, "manifest.json"), path.join(outputDirectory, "manifest.json")),
    cp(path.join(zoteroPackage, "bootstrap.js"), path.join(outputDirectory, "bootstrap.js")),
    copyIfPresent(
      path.join(zoteroPackage, "assets"),
      path.join(outputDirectory, "content/assets"),
    ),
    copyIfPresent(path.join(zoteroPackage, "locale"), path.join(outputDirectory, "locale")),
    copyIfPresent(path.join(zoteroPackage, "locales"), path.join(outputDirectory, "locales")),
  ]);
}

export function bundleOptions(outputDirectory) {
  return {
    bundle: true,
    entryPoints: [path.join(zoteroPackage, "src/index.ts")],
    format: "iife",
    globalName: "ZoteroCodexReader",
    outfile: path.join(outputDirectory, "content/zcr.js"),
    platform: "browser",
    target: ["firefox128"],
  };
}

export async function buildDevelopmentExtension(outputDirectory = defaultOutputDirectory) {
  requireNode24();
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(path.join(outputDirectory, "content"), { recursive: true });
  await Promise.all([
    copyStaticFiles(outputDirectory),
    build(bundleOptions(outputDirectory)),
  ]);
}

async function main() {
  const outputDirectory = readOption("--outdir", defaultOutputDirectory);
  await buildDevelopmentExtension(outputDirectory);
  console.log(`Built development extension at ${outputDirectory}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
