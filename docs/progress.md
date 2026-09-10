# Development progress

Current scope: **human product acceptance is staged on the signed-in `.zcr-dev` profile.** The working-tree development XPI (including the earlier MVP cleanup) is packaged and installed; the auto-running host-test driver is removed. S6 virgin-profile install and two-version host upgrade/rollback previously passed without sending; S7 is still source-only dry-run (no GitHub Release). S4/S5 `--s4`/`--s5` host QA that do not send remain on record. S3 remains delivered pending real-answer and follow-up-stop checks (quota resets 2026-09-15). S0/S1/S2 remain delivered on the same terms.

Living docs stay at their current paths. Superseded T0–T12 / first-pass design notes are in [archive](archive/README.md).

| Stage | Status | Evidence |
| --- | --- | --- |
| S0 repository/toolchain | Delivered | npm workspaces, Node 24 toolchain, strict TypeScript, lint/unit/build commands, deterministic XPI packaging and Zotero bootstrap are present |
| S1 native Zotero shell/layout | Development preview delivered | Native toolbar/dock, geometry, anchor, fixed/manual zoom, native-pane switching, three disable/enable cycles with listener counts, sibling-attachment separation and uninstall cleanup pass the dedicated-host workflow |
| S2 Codex runtime/login | Development preview delivered; 3 checks NOT RUN | Bundled pinned Codex extracted, verified and launched from the packaged XPI; policy gate and dedicated-home check pass; signed-in account restored; synthetic turn submitted; typed upstream refusal shown. Real streaming answer, non-empty output and stop remain NOT RUN because of the usage limit |
| S3 main feature loop | Development preview delivered; 2 checks NOT RUN | Real PDF selection shows More details / Ask above the native annotation popup; Ask drafts without sending; More details records the citation and submits explain; A/B isolation, close/reopen, disable/enable restore and return-to-source pass on the host. Real streamed answer and follow-up stop remain NOT RUN because the explain turn was refused |
| S4 chat settings / native interaction | Development preview; `--s4` host passed (no model send). MVP round 2 sidebar layout was revised after a live screenshot | Catalog composer, Markdown/KaTeX, width clamp, history, ten toolbar cycles, system-font chrome, A27/A28/A30 as before. Sidebar now uses one chrome row (history only when 2+ chats), hides generic PDF titles, centers a short empty hint, and keeps a single composer row plus a one-line preview footnote. Copy-diagnostics stays off the default UI; English remains the default. Live Zotero look still needs a reload of the new `package:dev` XPI |
| S5 history / recovery | Development preview; `--s5` host passed (no model send) | Resume-then-read recovery in unit tests; host kill/reload handshake, same conversation, disable stops process, injected uncertain leftover isolation without auto-send. In-flight turn resume NOT RUN (quota) |
| S6–S7 | S6 virgin + two-version host + S7 dry-run prep | Earlier host evidence on a1 `c1b898ac…`. `verify:install`, `verify:artifacts`, GitHub Actions unit CI + release **dry-run** workflow (no upload). Git-HEAD checkout rebuild, GitHub download, Node-free machine, LICENSE, and actual `gh release` still open. Live Codex streaming blocked until 2026-09-15 |

## Product acceptance launch (do this)

Exact commands and paths: [development.md 产品验收](development.md#产品验收现在就开). Walk the [user flow](zotero-codex-user-flow.md) against [A01–A30](qa/acceptance-v0.1.md).

```sh
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/profile" \
  -datadir "$PWD/.zcr-dev/data"
```

- XPI: `dist/zotero-codex-reader-0.3.0a1-dev.xpi` (SHA-256 `aba8fe1465ad8a61fd4bef248f4f1eee42a75f2f75a042c0ce07b916c9295567`), also copied to `.zcr-dev/profile/extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi`.
- Synthetic PDF to re-import if needed: `.zcr-dev/fixtures/reading.pdf`.
- After UI/core source changes: `npm run package:dev` then `node scripts/prepare-host-test.mjs --acceptance`. Do **not** use bare `prepare-host-test.mjs` (that installs the auto-running driver).

Do not judge streaming, stop, A23/A24 send, or in-flight resume until quota returns (~2026-09-15). Do not treat a usage-limit message as a model answer.

## Execution decisions

- The current version is npm/workspaces `0.3.0-alpha.1` and Zotero manifest `0.3.0a1`; the acceptance artifact is `dist/zotero-codex-reader-0.3.0a1-dev.xpi` (SHA-256 `aba8fe1465ad8a61fd4bef248f4f1eee42a75f2f75a042c0ce07b916c9295567`, about 98 MB with the pinned runtime). `dist/SHA256SUMS` matches that digest. Earlier host QA used `c1b898ac…`; that digest is historical.
- Keep the visible sidebar labeled as a development preview. Paper text is sent only from an explicit selection action; the whole PDF is not uploaded.
- Use only the ignored `.zcr-dev/` profile/data tree and synthetic PDFs for native host verification. The normal Zotero profile, library, login state and other Codex sessions remain outside the test.
- `scripts/prepare-host-test.mjs --acceptance` refreshes the signed-in `.zcr-dev/profile` XPI and fixture PDF and removes `zcr-host-test@local`. `--s2`…`--s6` still install an auto-running driver. `--s6` uses `.zcr-dev/s6-virgin/`. `--s6 --upgrade-xpi <newer> --rollback-xpi <older>` uses `.zcr-dev/s6-upgrade/` and requires two different local XPI versions. Neither S6 form writes the signed-in `.zcr-dev/profile`. It is a direct Node script, not an npm package script.
- Launch the dedicated Zotero so that it outlives the launching shell. Do not touch the dedicated window while a **driver** run is in progress.
- Core startup failures carry constant text (`RuntimeFailure`); typed upstream refusals use constant user-facing reasons. Private paths never reach the UI.

## Verification log

- Detailed evidence and limits: [S0/S1 QA record](qa/s0-s1.md), [S2 QA record](qa/s2.md), [S3 QA record](qa/s3.md), [S4 QA record](qa/s4.md), [S5 QA record](qa/s5.md), [S6 QA record](qa/s6.md), [A01–A30 matrix](qa/acceptance-v0.1.md).
- Repo hygiene (2026-09-10): `npm run typecheck`, `npm run lint`, `npm run test:unit` — **259 tests / 34 files pass**. `npm run package:dev` rewrote `dist/zotero-codex-reader-0.3.0a1-dev.xpi` (SHA256SUMS `aba8fe14…`). Stale `dist/` XPIs `0.1.0a2` and `0.2.0a1` were deleted. Superseded plans moved to `docs/archive/`. No host test and no regular Zotero profile.
- Product-acceptance staging (2026-09-09, after MVP cleanup): `npm run typecheck`, `npm run lint`, `npm run test:unit` — **248 tests / 33 files pass**. `npm run package:dev` wrote `dist/zotero-codex-reader-0.3.0a1-dev.xpi`. `npm run verify:artifacts` — 76 files, SHA256SUMS `2aab2704…`. `node scripts/prepare-host-test.mjs --acceptance` installed that XPI into `.zcr-dev/profile/extensions/` and removed `zcr-host-test@local`. The same XPI was copied onto `.zcr-dev/s6-virgin/` (signedOut, driver removed) so the login button can be seen without touching the signed-in tree. Regular profile `mi2zhr2s.default` was not used. No model request was sent. `--login`, `--s2`, and `--s3` were not run (quota).
- Earlier source checks after MVP cleanup: `npm run typecheck`, `npm run lint`, `npm run test:unit` — 241 tests / 31 files. That session did not rebuild the XPI; `dist/` was still a1 `c1b898ac…`.
- `npm run verify:artifacts` previously verified the older a1 XPI (76 files; SHA256SUMS `c1b898ac…`). `npm run release:dry-run` wrote a local plan (`githubRelease: null`). Dedicated `--s6` virgin host: 15/15 executed PASS, 2 NOT RUN. Dedicated `--s6` two-version host on `.zcr-dev/s6-upgrade/`: 19/19 executed PASS, 2 NOT RUN (a1 `c1b898ac…` → a2 `445f47243…` → a1). Dedicated `--s4`: 40/40 executed PASS, 5 NOT RUN. Dedicated `--s5`: 17/17 executed PASS, 1 NOT RUN. No model request was sent.
- Dedicated Zotero 9.0.6 host evidence for S1 (27/27) and S2 (12/12 executed, 3 NOT RUN) is unchanged.
- Dedicated Zotero 9.0.6 host evidence for S3: 23/23 executed checks pass; streamed answer and follow-up stop NOT RUN because the account's usage limit refused the submitted explain turn. No answer text was faked.
- Re-run `node scripts/prepare-host-test.mjs --s6` or the `--upgrade-xpi`/`--rollback-xpi` form before another S6 host run. After any driver run, re-run `--acceptance` before sitting down to accept again.
