/** Source-controlled release identity; build never substitutes the locally installed CLI. */
export const PINNED_RUNTIME = {
  codexVersion: '0.154.0',
  platform: 'darwin',
  architecture: 'arm64',
  entry: 'content/runtime/codex-aarch64-apple-darwin',
  size: 222655232,
  sha256: '4f85982624b3898c8991cb80c0981b2aa71070e3537046c9a95950318a95afcc',
  archive: {
    url: 'https://github.com/openai/codex/releases/download/rust-v0.154.0/codex-aarch64-apple-darwin.tar.gz',
    filename: 'codex-aarch64-apple-darwin.tar.gz',
    entry: 'codex-aarch64-apple-darwin',
    size: 88080735,
    sha256: '344310a0a591c1b192e04feff304321a69907c9498baaac331ca7e16ebcef9d7',
  },
  licenses: ['LICENSE', 'NOTICE', 'RATATUI-LICENSE', 'WEZTERM-LICENSE'],
} as const;
