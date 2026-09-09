import { RuntimeFailure, type ModelOption } from '../../../contracts/src/runtime.ts';
import { record } from './transport.ts';
import { string } from './models.ts';
// Audited against rust-v0.144.1 and a live isolated config/read probe of the pinned
// binary (2026-09-09). The native adapter removes the execution environment
// (environments.toml include_local=false, CODEX_EXEC_SERVER_URL=none); these flags
// remove the remaining optional capabilities, and validatePolicy checks the
// effective result before the runtime is usable.
const disabledFeatures = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'plugin_sharing', 'tool_suggest', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser', 'computer_use', 'image_generation', 'multi_agent', 'hooks', 'skill_mcp_dependency_install', 'workspace_dependencies', 'mentions_v2', 'goals', 'code_mode_host', 'shell_snapshot', 'auth_elicitation', 'tool_call_mcp_elicitation', 'memories', 'remote_control'];
const readerConfig: Record<string, unknown> = {
  cli_auth_credentials_store: 'file',
  approval_policy: 'never',
  approvals_reviewer: 'user',
  sandbox_mode: 'read-only',
  default_permissions: ':read-only',
  ...Object.fromEntries(disabledFeatures.map(feature => [`features.${feature}`, false])),
  project_doc_max_bytes: 0,
  'skills.include_instructions': false,
  'skills.bundled.enabled': false,
  'orchestrator.skills.enabled': false,
  'orchestrator.mcp.enabled': false,
  web_search: 'disabled',
  'tools.experimental_request_user_input.enabled': false,
  include_apps_instructions: false,
  include_collaboration_mode_instructions: false,
  include_environment_context: false,
  allow_login_shell: false,
  'analytics.enabled': false,
  'feedback.enabled': false,
  check_for_update_on_startup: false,
  'history.persistence': 'none',
};
/** Effective values config/read must report; `{}` requires an empty table. */
const expectedPolicy: Record<string, unknown> = {
  approval_policy: 'never', approvals_reviewer: 'user', sandbox_mode: 'read-only', default_permissions: ':read-only',
  cli_auth_credentials_store: 'file', web_search: 'disabled', project_doc_max_bytes: 0, allow_login_shell: false,
  check_for_update_on_startup: false, include_apps_instructions: false, include_collaboration_mode_instructions: false, include_environment_context: false,
  model_provider: null, openai_base_url: null, chatgpt_base_url: null, notify: null, hooks: null,
  experimental_thread_config_endpoint: null, experimental_thread_store_endpoint: null,
  mcp_servers: {}, plugins: {}, marketplaces: {}, model_providers: {},
  analytics: { enabled: false }, feedback: { enabled: false },
  skills: { include_instructions: false, bundled: { enabled: false } },
  orchestrator: { skills: { enabled: false }, mcp: { enabled: false } },
  history: { persistence: 'none' },
  features: Object.fromEntries(disabledFeatures.map(feature => [feature, false])),
};
const managedLayers = ['system', 'mdm', 'enterpriseManaged', 'project', 'legacyManagedConfigTomlFromFile', 'legacyManagedConfigTomlFromMdm'];
export function codexLaunchArgs(): string[] {
  return ['app-server', '--strict-config', ...Object.entries(readerConfig).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
}
function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const entries = Object.entries(expected as Record<string, unknown>);
  if (entries.length === 0) return Object.keys(actual).length === 0;
  return entries.every(([key, value]) => matches((actual as Record<string, unknown>)[key], value));
}
function policyFailure(reason: string) { return new RuntimeFailure(`Reader policy unavailable: ${reason}`); }
/** Fails closed unless the effective configuration and its provenance match the reader policy. */
export function validatePolicy(value: unknown, codexHome: string): void {
  try {
    const response = record(value);
    const config = record(response.config);
    if (!matches(config, expectedPolicy)) throw policyFailure('the effective configuration differs from the reader policy');
    if (Object.values(record(config.features)).some(flag => flag !== false && flag !== null)) throw policyFailure('an additional capability is enabled');
    if (!Array.isArray(response.layers)) throw policyFailure('configuration layers were not reported');
    let flags = 0;
    for (const entry of response.layers) {
      const layer = record(entry); const name = record(layer.name); const type = string(name.type);
      const empty = Object.keys(record(layer.config)).length === 0;
      if (type === 'sessionFlags') { flags++; continue; }
      if (type === 'user') {
        if (name.file !== `${codexHome}/config.toml` || name.profile !== null || !empty) throw policyFailure('a user configuration outside the dedicated account directory is active');
        continue;
      }
      if (managedLayers.includes(type) && empty) continue;
      throw policyFailure('a managed or project configuration layer is active');
    }
    if (flags !== 1) throw policyFailure('launch flags were not applied exactly once');
    for (const origin of Object.values(record(response.origins))) {
      if (record(record(origin).name).type !== 'sessionFlags') throw policyFailure('a setting has an unexpected origin');
    }
  } catch (error) { throw error instanceof RuntimeFailure ? error : policyFailure('the configuration report was malformed'); }
}
export const SYNTHETIC_QUESTION = '这是 Zotero Codex Reader 的连接测试，没有上传论文，也不需要使用任何工具。请用中文分两段简要解释先验概率与后验概率的区别，并给出一个直观的小例子。';
export function threadParams(cwd: string, model: ModelOption) {
  return { cwd, model: model.id, modelProvider: 'openai', serviceTier: model.defaultServiceTier, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only', config: { ...readerConfig, model_reasoning_effort: model.defaultReasoningEffort }, ephemeral: true, baseInstructions: 'You are a text-only connection test assistant. Answer the user directly. Never invoke tools or access files, commands, external resources, or other agents.', developerInstructions: 'No paper or attachment is provided. Do not claim to have accessed one.' };
}
/** Checks the thread/start response against the frozen request; names the first field that differs. */
export function validateThread(value: unknown, cwd: string, model: ModelOption): string {
  const response = record(value); const thread = record(response.thread); const sandbox = record(response.sandbox);
  // Live 0.144.1 probe: a null (catalog default) tier is echoed as "default"; explicit tiers verbatim.
  const tier = model.defaultServiceTier ?? 'default';
  const roots = response.runtimeWorkspaceRoots;
  const checks: Array<[string, boolean]> = [
    ['working directory', response.cwd === cwd && thread.cwd === cwd],
    ['approval policy', response.approvalPolicy === 'never' && response.approvalsReviewer === 'user'],
    ['sandbox', sandbox.type === 'readOnly' && sandbox.networkAccess === false],
    ['instruction sources', Array.isArray(response.instructionSources) && response.instructionSources.length === 0],
    ['model provider', response.modelProvider === 'openai' && thread.modelProvider === 'openai'],
    ['model', response.model === model.id],
    ['service tier', response.serviceTier === tier],
    ['reasoning effort', response.reasoningEffort === model.defaultReasoningEffort],
    ['thread identity', typeof thread.id === 'string' && thread.id.length > 0 && thread.ephemeral === true],
    ['thread history', Array.isArray(thread.turns) && thread.turns.length === 0],
    ['workspace roots', roots === undefined || (Array.isArray(roots) && roots.every(root => root === cwd))],
  ];
  const failed = checks.find(([, ok]) => !ok);
  if (failed) throw new RuntimeFailure(`Reader policy unavailable: the thread response differs from the reader policy (${failed[0]})`);
  return thread.id as string;
}
