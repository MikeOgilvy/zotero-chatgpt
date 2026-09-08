# Development progress

Current scope: **S0 + S1**, authorized on 2026-09-08. Later stages remain planned.

| Stage | Status | Evidence |
| --- | --- | --- |
| S0 repository/toolchain | In progress | Correct project path and existing Git author configuration verified; baseline being established |
| S1 native Zotero shell/layout | Not started | Real host installation, dock geometry and lifecycle tests required |
| S2–S7 | Planned | No login, model call or public release implemented |

## Execution decisions

- Work in the user's explicit repository checkout on a feature branch after a documentation baseline. The repository starts empty, and parallel work has disjoint file ownership; an additional worktree is not needed for this first stage.
- Preserve all existing plans; limit this delivery to a clearly labeled development XPI without Codex runtime or model calls.
- Use a dedicated, ignored `.zcr-dev/` profile/data tree for host verification. Keep any test fixture generation and optional host smoke harness separate from the normal development artifact.

## Verification log

No implementation tests have run yet.
