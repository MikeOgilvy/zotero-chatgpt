# Changelog

All notable user-facing changes will be recorded here. Versions below are **development previews**, not GitHub Releases.

## Unreleased

### Development preview `0.4.0-alpha.1`

- Adopted the MIT license for the project; the root `LICENSE` now ships inside the development XPI and `package.json` declares `"license": "MIT"`.
- Added agent/task/workspace contracts and persistent local services: workspace preferences, research profiles and SKILL.md, unified `@article`/`@chat` references, offline history/drafts, and a native task ledger with approval, undo and conflict detection.
- Added context planning and long-document handling: per-turn budget from the runtime window or the pinned catalog, focused and multi-pass reading, batch queueing, deterministic source ids and a 3 × 16 MiB local text cache, plus loaded-vs-disk SHA-256 PDF version checks.
- Added model capability/usage handling and multimodal support: catalog modalities, provider capability and rate-limit parsing, 2 MiB input images, verified 16 MiB generated images, and the explicit diagram workflow.
- Added the workspace, task, command-menu and UI-locale views, and made answer source links resolve `https://zcr.invalid/source/<documentId>/<pageIndex>` against the frozen document revision. The reading instruction now tells the model to emit that reserved form.
- Added an honest elapsed-time indicator for a running request: it counts whole seconds while unsettled, freezes at the first delivered text, and stops at the settled "Answered in N s"; missing timing shows an explicit unknown instead of an invented duration, so a slow answer no longer looks like a local hang or implies upstream quota/queueing was the app's fault. Related fixes from the merged `feat/usage-batch-1` branch: Unicode/currency math renders without mangling text, `@` references search every readable Zotero library, annotation candidates stay resolvable when the model omits a comment, the current PDF is prepared when the panel opens, every pasted/dropped clipboard image is kept, and the item-pane icon was redrawn.
- Merged the independently verified `fix/audit-bugs-ui` branch, fixing user-reported defects: answers blanking after citation rendering (`structuredClone`), the presenter not re-subscribing after a runtime reconnect, one failing view stopping the others, undiscoverable copy affordances, and the composer/profile/page-range/splitter/dock dark-mode issues; it also added answer typography with one stylesheet per view, composer spacing, remaining dynamic-string localization, an honest current-context chip, and one empty chat per paper instead of stacked duplicates.
- Verified in this working tree after both merges: `npm run typecheck` and `npm run lint` pass; `npm run test:unit` is **699 tests / 60 files** on two consecutive full runs (the previously flaky 3 MiB image-export test now has an explicit 15s budget with its measured ~2.5-2.7s reason, keeping its real work and assertions); `npm run package:dev` produces `dist/zotero-codex-reader-0.4.0a1-dev.xpi`; `npm run verify:artifacts` passes with **77 files** (SHA-256 `24d82e17ca2f1bae5ee5b2806d69845c600bed63a848abd070fb2321e9baf534` in `dist/SHA256SUMS`), and the redrawn `content/assets/icon.svg` is bundled byte-identical to source. This rebuild is newer than the `d33ab244…` artifact used for the host evidence below, so that host evidence does not describe this merged tree.
- Real-host verification re-run against the 0.4.0a1 development XPI (SHA-256 `d33ab244…`) with the project's own dedicated-profile tooling: `--context` **16/16**, `--context --native` **12/12** (0 driver-issued model requests), and the isolated s6 upgrade/rollback flow **22/22** from 0.3.0a1 to 0.4.0a1 and back, including records preserved across both switches and an explicit check that the older build refuses a schema-3 conversation without rewriting it. See `docs/progress.md` for the NOT RUN boundaries and the one non-reproducing first-run failure.
- Hardened `.github/workflows/ci.yml` and `release.yml`: the toolchain is pinned via `.nvmrc` (24.11.0, `engines >=24 <25`) instead of a floating major, CI now packages and verifies the development XPI (`runtime-prepare` → `package:dev` → `verify:artifacts`) in addition to `typecheck`/`lint`/`test:unit`, and no workflow uploads, publishes or tags anything. GUI Zotero host checks and `--live` model checks are explicitly excluded from CI.

Known limits (not yet verified): isolated official ChatGPT login and live model answers, stop/uncertain resume in flight, the final 0.4 XPI's native host UI, native annotation/acquisition against a real library or network, live image generation, and signed/public download or upgrade acceptance. No GitHub Release exists for this version.

### Development preview `0.3.0a1`

- Native Zotero 9 sidebar, selection actions, bundled Codex `0.144.1`.
- Dedicated-host S1–S5 checks on macOS arm64; S6 virgin-profile AddonManager install without sending.
- Known limits: ChatGPT Codex usage quota until 2026-09-15 blocks live answers; no public download; no Node-free install proof; Intel/Windows/Linux unsupported.

No GitHub Release exists for this tag.
