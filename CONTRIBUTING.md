# Contributing to Zotero Codex Reader

This is a community Zotero plugin. It is not affiliated with Zotero or OpenAI.

## Development

Read [AGENTS.md](AGENTS.md), [project decisions](docs/project-decisions.md), and [macOS development](docs/development.md).

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
```

Node 24 is for build and tests only. Do not add live Codex calls to default CI. Do not commit `.zcr-dev/`, authentication files, paper text, or conversation logs.

Host checks use an ignored dedicated profile under `.zcr-dev/` and synthetic PDFs. Never use a regular Zotero profile.

## Pull requests

Default CI runs typecheck, lint, and unit tests without credentials. Packaging the macOS arm64 XPI needs the pinned Darwin Codex runtime and is not part of Ubuntu CI.

Do not request GitHub Releases from CI. Local `npm run release:dry-run` writes a plan only.

## Reporting bugs

Use the issue template. If you have a diagnostics JSON export, paste only that whitelist payload. Do not attach `auth.json`, profile paths, PDFs, or full request logs. The default sidebar does not show a copy-diagnostics control.
