# Zotero Codex Reader

## Working context

- Work from this repository. Read `docs/project-decisions.md` and `docs/module-design.md` before implementation.
- Use `docs/superpowers/plans/2026-09-08-zcr-implementation-stages.md` for execution order; T0–T12 named in that plan are reference work packages, not a sequential prerequisite list. Superseded T0–T12 checklists and the first-pass design note live in `docs/archive/`.
- Read `docs/progress.md` to resume the current stage. User-facing behavior is defined in `docs/zotero-codex-user-flow.md`.
- Develop in Cursor with the official Codex extension on macOS. Keep one writer responsible for each file; use separate worktrees only for genuinely independent tasks.

## Reasoning

Use first-principles reasoning for non-trivial decisions. Separate source evidence, logical consequences, assumptions and speculation. Prefer mechanistic explanations, make important assumptions explicit, and consider counterexamples. Passing a mock test is not evidence of working Zotero integration.

## Architecture

- Production is a Zotero native extension with a TypeScript core and a bundled Codex App Server connected through Gecko stdio. Node is for build/tests only.
- Keep host-specific DOM, reader internals, process and file APIs in Zotero adapters. The core depends only on contracts and injected capabilities.
- Keep selected text, attachment identity and PDF position immutable across UI focus changes. Bind conversations to PDF attachments, including library/profile namespace.
- Keep session/process lifetime separate from view lifetime. Closing a sidebar must preserve work that belongs to the plugin service.
- Match Zotero's native visual language. Use real dock layout and native PDF scaling, not a covering panel or CSS scale imitation.

## Scope and verification

- Implement the currently authorized stage. Mark unfinished backend/login controls as development preview; never present fixture output as a real model response.
- For meaningful behavior changes, first write and observe a failing regression test, then implement and verify. Configuration and human documentation need direct checks rather than source-text tests.
- Read actual scripts from `package.json`. Report exact checks run and their limits; distinguish unit, host and packaged-XPI validation.
- Use only the dedicated `.zcr-dev/` profile/data directories and synthetic PDFs for host tests. Preserve the user's regular Zotero profile, library and other Codex sessions.
- Credentials remain with the official authentication flow. Do not read or copy authentication files into this repo, tests, artifacts or diagnostics.
- Public artifacts contain only explicit runtime assets, declared licenses and non-private files. Keep logs and development profiles out of Git.

