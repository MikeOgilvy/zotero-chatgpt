# Development progress

Current scope: **S0 + S1 development preview delivered**. Next implementation stage: **S2**.

| Stage | Status | Evidence |
| --- | --- | --- |
| S0 repository/toolchain | Delivered | npm workspaces, Node 24 toolchain, strict TypeScript, lint/unit/build commands, deterministic XPI packaging and Zotero bootstrap are present |
| S1 native Zotero shell/layout | Development preview delivered | Native toolbar/dock, geometry, anchor, fixed/manual zoom, native-pane switching, three disable/enable cycles with listener counts, sibling-attachment separation and uninstall cleanup pass the dedicated-host workflow |
| S2 Codex runtime/login | Next | Bundled Codex process, official login, protocol handshake and real model response are not implemented |
| S3–S7 | Planned | Selection actions, full chat/history/recovery, release QA and public distribution are not implemented |

## Execution decisions

- The current version is npm/workspaces `0.1.0-alpha.2` and Zotero manifest `0.1.0a2`; the development artifact is `dist/zotero-codex-reader-0.1.0a2-dev.xpi`.
- Keep the visible sidebar labeled as a development preview until a real S2 backend and login path are connected. Fixture text is not a model response.
- Use only the ignored `.zcr-dev/` profile/data tree and synthetic PDF for native host verification. The normal Zotero profile, library, login state and other Codex sessions remain outside the test.
- `scripts/prepare-host-test.mjs` prepares the isolated profile, installs the selected development XPI and test driver, and writes synthetic input. It is a direct Node script, not an npm package script.

## Verification log

- Detailed evidence and limits: [S0/S1 QA record](qa/s0-s1.md).
- Source checks: `npm run typecheck`, `npm run lint`, `npm run build` and `npm run package:dev` pass. `npm run test:unit` passes 26 tests across 6 files.
- Development package: `dist/zotero-codex-reader-0.1.0a2-dev.xpi` builds from the manifest version and contains the native UI assets and locale.
- Dedicated Zotero 9.0.6 host evidence currently confirms:
  - the real development chat content is visible in the native pane and uses the active attachment identity;
  - opening the pane changes PDF viewport width from 1512 to 1155;
  - after reading onward, closing keeps page 2 and the vertical anchor at top 745;
  - fixed zoom adapts to page width and restores to 2.1, while a manual zoom of 1.6 remains authoritative.
- The current dedicated-host workflow passes 27/27 checks. It also confirms native-pane toggling restores native content, reopening Codex selects the chat content, three disable/enable cycles leave one toolbar button with stable listener counts, sibling attachments remain distinct, and uninstall removes the add-on, button, pane registration, active classes and listeners.
- The host driver uninstalls the tested development add-on at the end. Run `node scripts/prepare-host-test.mjs` again before repeating the native workflow.
- No backend/login/selection-action acceptance has run because those features are not implemented.
