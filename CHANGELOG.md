# Changelog

All notable user-facing changes will be recorded here. Versions below are **development previews**, not GitHub Releases.

## Unreleased

### Development preview `0.4.0-alpha.1`

- Adopted the MIT license for the project; the root `LICENSE` now ships inside the development XPI and `package.json` declares `"license": "MIT"`.
- Added agent/task/workspace contracts and persistent local services: workspace preferences, research profiles and SKILL.md, unified `@article`/`@chat` references, offline history/drafts, and a native task ledger with approval, undo and conflict detection.
- Added context planning and long-document handling: per-turn budget from the runtime window or the pinned catalog, focused and multi-pass reading, batch queueing, deterministic source ids and a 3 × 16 MiB local text cache, plus loaded-vs-disk SHA-256 PDF version checks.
- Added model capability/usage handling and multimodal support: catalog modalities, provider capability and rate-limit parsing, 2 MiB input images, verified 16 MiB generated images, and the explicit diagram workflow.
- Added the workspace, task, command-menu and UI-locale views, and made answer source links resolve `https://zcr.invalid/source/<documentId>/<pageIndex>` against the frozen document revision. The reading instruction now tells the model to emit that reserved form.
- Verified in this working tree: `npm run typecheck` and `npm run lint` pass; `npm run test:unit` is **632 tests / 57 files**; `npm run package:dev` produces `dist/zotero-codex-reader-0.4.0a1-dev.xpi`; `npm run verify:artifacts` passes with **77 files** (digest in `dist/SHA256SUMS`). A clean-checkout rebuild (temporary `git worktree` at HEAD + `npm ci`) reproduced typecheck, 631 unit tests, `package:dev`, and `verify:artifacts` (**77 files**) with the identical SHA-256 digest; the pinned runtime binary was reused from the local cache rather than re-downloaded.
- Real-host verification re-run against the 0.4.0a1 development XPI (SHA-256 `d33ab244…`) with the project's own dedicated-profile tooling: `--context` **16/16**, `--context --native` **12/12** (0 driver-issued model requests), and the isolated s6 upgrade/rollback flow **22/22** from 0.3.0a1 to 0.4.0a1 and back, including records preserved across both switches and an explicit check that the older build refuses a schema-3 conversation without rewriting it. See `docs/progress.md` for the NOT RUN boundaries and the one non-reproducing first-run failure.
- Hardened `.github/workflows/ci.yml` and `release.yml`: the toolchain is pinned via `.nvmrc` (24.11.0, `engines >=24 <25`) instead of a floating major, CI now packages and verifies the development XPI (`runtime-prepare` → `package:dev` → `verify:artifacts`) in addition to `typecheck`/`lint`/`test:unit`, and no workflow uploads, publishes or tags anything. GUI Zotero host checks and `--live` model checks are explicitly excluded from CI.

Known limits (not yet verified): isolated official ChatGPT login and live model answers, stop/uncertain resume in flight, the final 0.4 XPI's native host UI, native annotation/acquisition against a real library or network, live image generation, and signed/public download or upgrade acceptance. No GitHub Release exists for this version.

### Development preview `0.3.0a1`

- Native Zotero 9 sidebar, selection actions, bundled Codex `0.144.1`.
- Dedicated-host S1–S5 checks on macOS arm64; S6 virgin-profile AddonManager install without sending.
- Known limits: ChatGPT Codex usage quota until 2026-09-15 blocks live answers; no public download; no Node-free install proof; Intel/Windows/Linux unsupported.

No GitHub Release exists for this tag.
