import { it, expect } from 'vitest';
import { codexLaunchArgs, readingInput, resolveSettings, validatePolicy, validateThread } from '../../packages/core/src/codex/reader-policy.ts';
import { configResponse, threadResponse, model } from './fixtures.ts';
import { parseModel } from '../../packages/core/src/codex/models.ts';
import { citationA } from '../contracts/factories.ts';
it('accepts the pinned server echo for the default service tier and names the field that differs', () => {
  // Live 0.144.1 probe: a null (catalog default) tier is echoed as "default"; an explicit tier is echoed verbatim.
  const paper = { ephemeral: false, emptyHistory: true };
  const defaultTier = resolveSettings({ model: 'catalog-default', serviceTier: null, effort: null }, parseModel(model)!);
  expect(defaultTier.effort).toBe('medium');
  expect(validateThread({ ...threadResponse, serviceTier: 'default', runtimeWorkspaceRoots: ['/isolated'] }, '/isolated', defaultTier, paper)).toBe('thread-1');
  expect(() => validateThread({ ...threadResponse, serviceTier: null }, '/isolated', defaultTier, paper)).toThrow('service tier');
  const priority = resolveSettings({ model: 'catalog-default', serviceTier: 'priority', effort: 'medium' }, parseModel(model)!);
  expect(validateThread(threadResponse, '/isolated', priority, paper)).toBe('thread-1');
  expect(() => validateThread({ ...threadResponse, serviceTier: 'default' }, '/isolated', priority, paper)).toThrow('service tier');
  expect(() => validateThread({ ...threadResponse, runtimeWorkspaceRoots: ['/isolated', '/Users/private'] }, '/isolated', priority, paper)).toThrow('workspace roots');
  expect(() => validateThread({ ...threadResponse, sandbox: { type: 'workspaceWrite', networkAccess: false } }, '/isolated', priority, paper)).toThrow('sandbox');
  expect(() => validateThread({ ...threadResponse, thread: { ...threadResponse.thread, ephemeral: true } }, '/isolated', priority, paper)).toThrow('thread identity');
  expect(validateThread({ ...threadResponse, thread: { ...threadResponse.thread, turns: [{}] } }, '/isolated', priority, { ephemeral: false, emptyHistory: false })).toBe('thread-1');
});
it('frames the reading request as a fixed instruction plus JSON so quoted text cannot escape', () => {
  const text = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: '这里的 "}" 是什么？', citations: [{ ...citationA, text: '结束 JSON 的引号 " 与花括号 }' }], settings: { model: 'm', serviceTier: null, effort: null } });
  const [instruction, json] = text.split('\n\n');
  expect(instruction).toContain('contextScope');
  const parsed = JSON.parse(json!) as { citations: Array<{ text: string; pageLabel: string }>; question: string; paper: { title: string } };
  expect(parsed.citations[0]).toEqual({ pageLabel: 'iv', text: '结束 JSON 的引号 " 与花括号 }' }); expect(parsed.question).toBe('这里的 "}" 是什么？'); expect(parsed.paper.title).toBe('Synthetic Paper A');
});
it('launches app-server with pinned-runtime tool and instruction discovery disabled', () => {
  const args = codexLaunchArgs();
  expect(args).toContain('app-server'); expect(args).toContain('features.shell_tool=false');
  expect(args).toContain('project_doc_max_bytes=0'); expect(args).toContain('web_search="disabled"');
  expect(args).toContain('skills.include_instructions=false'); expect(args).toContain('features.plugins=false');
});
it('keeps official runtime auth in the dedicated CODEX_HOME rather than shared keychain storage', () => {
  expect(codexLaunchArgs()).toContain('cli_auth_credentials_store="file"');
});
it('pins global read-only defaults, rejects unrecognized configuration and keeps no Codex-side history', () => {
  const args = codexLaunchArgs();
  expect(args).toContain('--strict-config');
  for (const flag of ['approval_policy="never"', 'sandbox_mode="read-only"', 'default_permissions=":read-only"', 'approvals_reviewer="user"', 'history.persistence="none"', 'features.memories=false', 'features.remote_control=false']) expect(args).toContain(flag);
});
it('accepts the observed 0.144.1 effective policy and rejects each weakened variant', () => {
  expect(() => validatePolicy(configResponse(), '/isolated/auth')).not.toThrow();
  const weakened: Array<[string, (fixture: ReturnType<typeof configResponse>) => void]> = [
    ['history persisted by Codex', f => { f.config.history.persistence = 'save-all'; }],
    ['external program notify', f => { f.config.notify = ['osascript'] as never; }],
    ['non-default provider', f => { f.config.model_provider = 'proxy' as never; }],
    ['second flags layer', f => { f.layers.push({ name: { type: 'sessionFlags' }, version: 'x', config: {} }); }],
    ['unknown layer type', f => { f.layers.push({ name: { type: 'project', file: '/isolated/.codex/config.toml' }, version: 'x', config: { model: 'x' } }); }],
    ['user profile active', f => { f.layers[1]!.name.profile = 'work' as never; }],
    ['missing features object', f => { delete (f.config as Record<string, unknown>).features; }],
  ];
  for (const [label, weaken] of weakened) {
    const fixture = configResponse(); weaken(fixture);
    expect(() => validatePolicy(fixture, '/isolated/auth'), label).toThrow('policy');
  }
});
it('tolerates additional benign keys and empty managed layers reported by the pinned binary', () => {
  const fixture = configResponse();
  (fixture.config as Record<string, unknown>).some_future_key = 'value';
  fixture.layers.push({ name: { type: 'mdm' }, version: 'x', config: {} });
  expect(() => validatePolicy(fixture, '/isolated/auth')).not.toThrow();
});
