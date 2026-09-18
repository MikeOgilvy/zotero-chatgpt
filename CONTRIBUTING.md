# Contributing to Zotero GPT Reader

This is a community Zotero plugin. It is not affiliated with Zotero or OpenAI.

## Development

Read [AGENTS.md](AGENTS.md), [architecture](docs/module-design.md), and [macOS development](docs/development.md).

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
```

Node 24 is for build and tests only. Do not add live Codex calls to default CI. Do not commit `.zcr-dev/`, authentication files, paper text, or conversation logs.

Host checks use an ignored dedicated profile under `.zcr-dev/` and synthetic PDFs. Never use a regular Zotero profile.

## Pull requests

Default CI (`.github/workflows/ci.yml`) runs typecheck, lint and unit tests without credentials, then packages the macOS arm64 development XPI on the Ubuntu runner (`runtime-prepare` → `package:dev` → `test:unit` → `verify:artifacts`). The pinned Darwin Codex runtime is downloaded and hashed there but never executed; host checks against a real Zotero stay local. See [docs/development.md](docs/development.md).

Do not request GitHub Releases from CI. Local `npm run release:dry-run` writes a plan only.

## Reporting bugs

Use the issue template. If you have a diagnostics JSON export, paste only that whitelist payload. Do not attach `auth.json`, profile paths, PDFs, or full request logs. The default sidebar does not show a copy-diagnostics control.
