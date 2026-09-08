import { mkdir, rm, watch } from "node:fs/promises";
import path from "node:path";

import { context } from "esbuild";

import { bundleOptions, copyStaticFiles } from "./build.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceDirectory = path.join(repositoryRoot, "packages/zotero");
const outputDirectory = path.join(repositoryRoot, "build/dev");

if (process.versions.node.split(".")[0] !== "24") {
  throw new Error(`Node 24 is required; found ${process.versions.node}`);
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(path.join(outputDirectory, "content"), { recursive: true });
await copyStaticFiles(outputDirectory);

const buildContext = await context(bundleOptions(outputDirectory));
await buildContext.watch();

const abortController = new AbortController();
const staticWatcher = watch(sourceDirectory, {
  recursive: true,
  signal: abortController.signal,
});

let copyPending = false;
const copyChangedStaticFiles = async () => {
  if (copyPending) {
    return;
  }
  copyPending = true;
  try {
    await copyStaticFiles(outputDirectory);
  } finally {
    copyPending = false;
  }
};

const watchStaticFiles = async () => {
  try {
    for await (const event of staticWatcher) {
      if (event.filename && !event.filename.startsWith("src/")) {
        await copyChangedStaticFiles();
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      throw error;
    }
  }
};

let stopping = false;
const stop = async () => {
  if (stopping) {
    return;
  }
  stopping = true;
  abortController.abort();
  await buildContext.dispose();
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stop().then(
      () => process.exit(0),
      (error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      },
    );
  });
}

console.log(`Watching development extension at ${outputDirectory}`);
await watchStaticFiles();
