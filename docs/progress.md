# Development progress

Current scope: **S2 runtime/login delivered as a development preview, pending the real-answer checks**, which are blocked only by the user's exhausted ChatGPT Codex usage limit (resets 2026-09-15). S0/S1 remain delivered. Next stage: **S3** once the three NOT RUN answer/stop checks pass.

| Stage | Status | Evidence |
| --- | --- | --- |
| S0 repository/toolchain | Delivered | npm workspaces, Node 24 toolchain, strict TypeScript, lint/unit/build commands, deterministic XPI packaging and Zotero bootstrap are present |
| S1 native Zotero shell/layout | Development preview delivered | Native toolbar/dock, geometry, anchor, fixed/manual zoom, native-pane switching, three disable/enable cycles with listener counts, sibling-attachment separation and uninstall cleanup pass the dedicated-host workflow |
| S2 Codex runtime/login | Development preview delivered; 3 checks NOT RUN | Bundled pinned Codex extracted, verified and launched from the packaged XPI; `config/read` policy gate and dedicated-home check pass on the host; signed-in account state restored from the plugin-private `CODEX_HOME`; `thread/start` validated and `turn/start` submitted; typed upstream refusal shown; disable stops the owned process; re-enable restores login and the terminal request without resending. Real streaming answer, non-empty output and stop remain NOT RUN because the upstream refused the turn (usage limit) |
| S3–S7 | Planned | Selection actions, full chat/history/recovery, release QA and public distribution are not implemented |

## Execution decisions

- The current version is npm/workspaces `0.2.0-alpha.1` and Zotero manifest `0.2.0a1`; the development artifact is `dist/zotero-codex-reader-0.2.0a1-dev.xpi` (SHA-256 `2dd92f31…16e0a`, about 101 MB with the pinned runtime).
- Keep the visible sidebar labeled as a development preview. It runs only the fixed synthetic connection test; no paper text is sent in S2.
- Use only the ignored `.zcr-dev/` profile/data tree and synthetic PDF for native host verification. The normal Zotero profile, library, login state and other Codex sessions remain outside the test. The dedicated profile's ChatGPT login belongs to the plugin-private account directory and is never read or copied.
- `scripts/prepare-host-test.mjs [--s2] [--login]` prepares the isolated profile, installs the selected development XPI and test driver, and writes synthetic input. It is a direct Node script, not an npm package script.
- Launch the dedicated Zotero so that it outlives the launching shell (a tool- or terminal-managed process). A shell-backgrounded launch was killed together with its parent during the first S2 attempt.
- Core startup failures carry constant text (`RuntimeFailure`) that the supervisor surfaces; other native errors stay generic so private paths never reach the UI.

## Verification log

- Detailed evidence and limits: [S0/S1 QA record](qa/s0-s1.md), [S2 QA record](qa/s2.md).
- Source checks: `npm run typecheck`, `npm run lint`, `npm run build` and `npm run package:dev` pass. `npm run test:unit` passes 120 tests across 17 files.
- Isolated pinned-binary probes (no login, no model call) established the real 0.144.1 `config/read`, layer/origin and `thread/start` echo shapes used by the policy gate and thread validation.
- Dedicated Zotero 9.0.6 host evidence for S1 (27/27 checks) is unchanged from the S0/S1 record.
- Dedicated Zotero 9.0.6 host evidence for S2: 12/12 executed checks pass, 3 answer/stop checks NOT RUN because the account's usage limit refused the submitted turn. The refusal reason is shown from the typed upstream error; no answer text was faked.
- The S2 host driver does not uninstall the add-on; re-run `node scripts/prepare-host-test.mjs --s2` before another run. Do not touch the dedicated Zotero window while a run is in progress.
- No selection-action acceptance has run because that feature is not implemented.
