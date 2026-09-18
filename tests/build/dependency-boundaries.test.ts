import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The product layering, enforced as a test rather than as a comment:
 *
 *   contracts  <-  core  <-  zotero
 *
 * Inside `packages/zotero/src` the reader and the library read side sit below the native write side:
 *
 *   host / reader / library  <-  actions
 *
 * `agent` is not a layer name here: agent/tool execution is the task orchestration in `core/tasks`
 * plus whatever a skill or the UI drives through a port. A reader-only build must be able to skip
 * the write half entirely, which is only true while these directions hold. The `chat` UI in
 * particular must not import `zotero/actions` (native writes) or `core/tasks` (Agent orchestration);
 * it reaches them only through the injected task/action ports.
 */
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const packagesRoot = path.join(repositoryRoot, 'packages');

function sourceFiles(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) { entries.push(...sourceFiles(full)); continue; }
    if (/\.ts$/u.test(name) && !name.endsWith('.d.ts')) entries.push(full);
  }
  return entries;
}

/** Every `from '...'`, `import('...')` and `export ... from '...'` specifier in one file. */
function importSpecifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [/from\s+'([^']+)'/gu, /import\s*\(\s*'([^']+)'\s*\)/gu, /from\s+"([^"]+)"/gu];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) if (match[1]) found.push(match[1]);
  return found;
}

interface Edge { from: string; to: string }

function dependencyEdges(): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFiles(packagesRoot)) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!resolved.startsWith(packagesRoot)) continue;
      edges.push({ from: path.relative(repositoryRoot, file), to: path.relative(repositoryRoot, resolved) });
    }
  }
  return edges;
}

const edges = dependencyEdges();
const violations = (within: (file: string) => boolean, target: RegExp): string[] =>
  edges.filter(edge => within(edge.from) && target.test(edge.to)).map(edge => `${edge.from} -> ${edge.to}`);
const unique = (values: string[]): string[] => [...new Set(values)].sort();

describe('module dependency boundaries', () => {
  it('parses the imports it guards, including the action -> read edge', () => {
    expect(edges.length).toBeGreaterThan(100);
    expect(edges).toContainEqual({ from: 'packages/zotero/src/actions/native.ts', to: 'packages/zotero/src/library/native-read.ts' });
    expect(edges).toContainEqual({ from: 'packages/zotero/src/library/reference.ts', to: 'packages/zotero/src/reader/document.ts' });
    expect(edges).toContainEqual({ from: 'packages/zotero/src/actions/files.ts', to: 'packages/zotero/src/library/native-files.ts' });
  });

  it('keeps contracts below core and zotero', () => {
    expect(unique(edges.filter(edge => edge.from.startsWith('packages/contracts/') && !edge.to.startsWith('packages/contracts/'))
      .map(edge => `${edge.from} -> ${edge.to}`))).toEqual([]);
  });

  it('keeps core independent of the Zotero adapter package', () => {
    expect(violations(file => file.startsWith('packages/core/'), /^packages\/zotero\//u)).toEqual([]);
  });

  it('keeps contracts and core free of Node and Zotero runtime details', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(packagesRoot, 'contracts')).concat(sourceFiles(path.join(packagesRoot, 'core')))) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('node:') || specifier === 'zotero' || specifier.startsWith('chrome://')) offenders.push(`${path.relative(repositoryRoot, file)}: ${specifier}`);
      }
    }
    expect(unique(offenders)).toEqual([]);
  });

  it('never lets the reader or library read side depend on the native write side', () => {
    expect(violations(file => /^packages\/zotero\/src\/(reader|library)\//u.test(file), /^packages\/zotero\/src\/actions\//u)).toEqual([]);
  });

  // The reader context is the aggregation layer the chat presenter reads, so the dependency points
  // chat -> reader and never back. A `reader/` file importing the chat UI would mean the open-PDF
  // state grew a second owner downstream of the UI.
  it('never lets the reader side depend on the chat UI', () => {
    expect(violations(file => file.startsWith('packages/zotero/src/reader/'), /^packages\/zotero\/src\/chat\//u)).toEqual([]);
  });

  // The library read side is the `createLibraryReferencePort` surface. The one historical edge,
  // `library/reference.ts -> chat/pick-images.ts`, was a misplaced byte->image helper that now lives
  // in `contracts/src/image.ts`; this assertion keeps that edge from coming back.
  it('never lets the library read side depend on the chat UI', () => {
    expect(violations(file => file.startsWith('packages/zotero/src/library/'), /^packages\/zotero\/src\/chat\//u)).toEqual([]);
  });

  it('never lets the chat UI import the native write implementation', () => {
    expect(violations(file => file.startsWith('packages/zotero/src/chat/'), /^packages\/zotero\/src\/actions\//u)).toEqual([]);
  });

  // Chat must not reach the Agent task orchestration either. The candidate parser moved to
  // `contracts` so the presenter imports it without pulling `core/tasks` into the chat path; a
  // remaining edge here means the Agent dependency has crept back into a Chat-only module.
  it('never lets the chat UI import the Agent task orchestration', () => {
    expect(violations(file => file.startsWith('packages/zotero/src/chat/'), /^packages\/core\/src\/tasks\//u)).toEqual([]);
  });

  it('has no agent directory: action execution lives in core/tasks and zotero/actions', () => {
    expect(readdirSync(path.join(packagesRoot, 'zotero/src')).filter(name => name === 'agent')).toEqual([]);
  });
});
