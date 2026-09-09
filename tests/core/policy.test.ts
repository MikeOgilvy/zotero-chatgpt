import { it, expect } from 'vitest';
import { codexLaunchArgs, validatePolicy, validateThread } from '../../packages/core/src/codex/reader-policy.ts';
import { configResponse, threadResponse } from './fixtures.ts';
import { parseModel } from '../../packages/core/src/codex/models.ts';
import { model } from './fixtures.ts';
it('accepts the pinned server echo for the default service tier and names the field that differs', () => {
  // Live 0.144.1 probe: a null (catalog default) tier is echoed as "default"; an explicit tier is echoed verbatim.
  const defaultTier = parseModel({ ...model, defaultServiceTier: null })!;
  expect(validateThread({ ...threadResponse, serviceTier: 'default', runtimeWorkspaceRoots: ['/isolated'] }, '/isolated', defaultTier)).toBe('thread-1');
  expect(() => validateThread({ ...threadResponse, serviceTier: null }, '/isolated', defaultTier)).toThrow('service tier');
  const priority = parseModel(model)!;
  expect(validateThread(threadResponse, '/isolated', priority)).toBe('thread-1');
  expect(() => validateThread({ ...threadResponse, serviceTier: 'default' }, '/isolated', priority)).toThrow('service tier');
  expect(() => validateThread({ ...threadResponse, runtimeWorkspaceRoots: ['/isolated', '/Users/private'] }, '/isolated', priority)).toThrow('workspace roots');
  expect(() => validateThread({ ...threadResponse, sandbox: { type: 'workspaceWrite', networkAccess: false } }, '/isolated', priority)).toThrow('sandbox');
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
