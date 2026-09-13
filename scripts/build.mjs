import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { copyBundledRuntime } from "./runtime-assets.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const zoteroPackage = path.join(repositoryRoot, "packages/zotero");
const defaultOutputDirectory = path.join(repositoryRoot, "build/dev");
const require = createRequire(import.meta.url);

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
    // The project's own MIT license must ship with the extension; it is not a third-party asset.
    cp(path.join(repositoryRoot, "LICENSE"), path.join(outputDirectory, "LICENSE")),
    copyIfPresent(
      path.join(zoteroPackage, "assets"),
      path.join(outputDirectory, "content/assets"),
    ),
    // Native Preferences pane fragment; the matching script is bundled below.
    copyIfPresent(
      path.join(zoteroPackage, "preferences"),
      path.join(outputDirectory, "content/preferences"),
    ),
    copyIfPresent(path.join(zoteroPackage, "locale"), path.join(outputDirectory, "locale")),
    copyIfPresent(path.join(zoteroPackage, "locales"), path.join(outputDirectory, "locales")),
  ]);
  await copyThirdPartyAssets(outputDirectory);
}

function packageRoot(specifier) {
  let dir = path.dirname(require.resolve(specifier));
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Unable to locate package root for ${specifier}`);
}

async function copyThirdPartyAssets(outputDirectory) {
  const katexRoot = packageRoot("katex");
  const katexDest = path.join(outputDirectory, "content/assets/katex");
  const licenses = path.join(outputDirectory, "content/assets/licenses");
  await Promise.all([mkdir(path.join(katexDest, "fonts"), { recursive: true }), mkdir(licenses, { recursive: true })]);
  await Promise.all([
    cp(path.join(katexRoot, "dist/katex.min.css"), path.join(katexDest, "katex.min.css")),
    cp(path.join(katexRoot, "dist/fonts"), path.join(katexDest, "fonts"), { recursive: true }),
    cp(path.join(katexRoot, "LICENSE"), path.join(licenses, "katex.LICENSE")),
    cp(path.join(packageRoot("markdown-it"), "LICENSE"), path.join(licenses, "markdown-it.LICENSE")),
    cp(path.join(packageRoot("dompurify"), "LICENSE"), path.join(licenses, "dompurify.LICENSE")),
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
    define: {
      __ZCR_SIDEBAR_CSS__: JSON.stringify(readFileSync(path.join(zoteroPackage, "assets/sidebar.css"), "utf8")),
    },
  };
}

export function preferencesBundleOptions(outputDirectory) {
  return {
    bundle: true,
    entryPoints: [path.join(zoteroPackage, "src/preferences-entry.ts")],
    format: "iife",
    outfile: path.join(outputDirectory, "content/preferences/pane.js"),
    platform: "browser",
    target: ["firefox128"],
  };
}

export async function buildDevelopmentExtension(outputDirectory = defaultOutputDirectory, options = {}) {
  requireNode24();
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(path.join(outputDirectory, "content"), { recursive: true });
  // Static files first: the pane fragment and its bundle land in the same directory.
  await Promise.all([
    copyStaticFiles(outputDirectory),
    copyBundledRuntime(outputDirectory, options.runtime),
  ]);
  await Promise.all([
    build(bundleOptions(outputDirectory)),
    build(preferencesBundleOptions(outputDirectory)),
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
