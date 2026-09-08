/** Source-controlled release identity; build never substitutes the locally installed CLI. */
export const PINNED_RUNTIME = {
  codexVersion: '0.144.1',
  platform: 'darwin',
  architecture: 'arm64',
  entry: 'content/runtime/codex-aarch64-apple-darwin',
  size: 260405808,
  sha256: '29915529b97697def1a957b0505e770aa6a45744435d62fc263e98d7619e167a',
  archive: {
    url: 'https://github.com/openai/codex/releases/download/rust-v0.144.1/codex-aarch64-apple-darwin.tar.gz',
    filename: 'codex-aarch64-apple-darwin.tar.gz',
    entry: 'codex-aarch64-apple-darwin',
    size: 98299911,
    sha256: '88e72ac8bd30815f7d18e62dac333dc20ce3ad1cba94be1649a1977dd9bfdbb8',
  },
  licenses: ['LICENSE', 'NOTICE', 'RATATUI-LICENSE', 'WEZTERM-LICENSE'],
} as const;
