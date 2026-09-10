# Acceptance matrix v0.1 (development preview)

Date: 2026-09-09. This is **not** a release-candidate sign-off.

Human-acceptance build (working tree, 2026-09-09 evening): npm `0.3.0-alpha.1`, Zotero manifest `0.3.0a1`, platform macOS arm64, XPI `dist/zotero-codex-reader-0.3.0a1-dev.xpi`, SHA-256 `2aab2704152b7e1b57fc1295a12550c8d46f5f73019650b810f37487777881d6`. Staged with `node scripts/prepare-host-test.mjs --acceptance` into `.zcr-dev/profile` (host driver removed). Launch path: [development.md 产品验收](../development.md#产品验收现在就开).

Earlier dedicated-host rows below were observed on `c1b898ac4e35de49a65c96ce56e08db6949071b62618ff7c34a01672b942a0db` and were not re-run for this packaging.

Environment: Zotero 9.0.6 on macOS Apple Silicon; bundled Codex `0.144.1`. Node 24.11.0 is build/test only. Dedicated ignored `.zcr-dev/` + synthetic PDF. Regular profile `mi2zhr2s.default` was not used for these checks.

PASS below means a dedicated host driver observed the behavior on a development XPI, or a named unit check where the row says so. Inherited host evidence is from [s0-s1.md](s0-s1.md), [s2.md](s2.md), [s3.md](s3.md), [s4.md](s4.md), [s5.md](s5.md). Cases that need a live model turn stay NOT RUN until the ChatGPT Codex usage limit resets on 2026-09-15. No fixture text is recorded as a model answer.

| Case | Result | Observed | Evidence | Limit |
| --- | --- | --- | --- | --- |
| A01 | PASS | More details opened chat and submitted one explain | [s3.md](s3.md) | Streamed answer refused (quota) |
| A02 | PASS | Ask drafts and focuses; no send. Follow-up send after Ask | [s3.md](s3.md), [s4.md](s4.md) | Send after Ask NOT RUN (quota) |
| A03 | PASS | Sibling attachment B empty; A restored | [s3.md](s3.md) | Synthetic PDFs only |
| A04 | PASS | Switch A→B does not copy A; switch-back restores A | [s3.md](s3.md) | In-flight token isolation not observed (quota) |
| A05 | NOT RUN | History lists the current conversation; 新对话 available | [s4.md](s4.md) | Full old/new thread remap after several real turns not executed |
| A06 | NOT RUN | Dedup/requestId unit tests | `tests/core/` | Host double-click / lost-ack retry not executed |

| A07 | NOT RUN | Stop during a live answer | — | Quota |
| A08 | PASS | Injected uncertain leftover isolated; no auto-send. In-flight resume | [s5.md](s5.md) | In-flight resume NOT RUN (quota) |
| A09 | PASS | Close/reopen and remount keep conversation; sidebar close does not kill process | [s3.md](s3.md), [s5.md](s5.md) | Cursor-expiry host case not separately logged |
| A10 | PASS | Return-to-source navigates to cited page | [s3.md](s3.md) | Roman vs numeric page-label pair not a dedicated host row |
| A11 | NOT RUN | Cross-page, huge, and empty selection | — | Not in S3/S4 drivers |
| A12 | NOT RUN | Sanitization/KaTeX unit tests; host loaded KaTeX CSS | [s4.md](s4.md), unit | Untrusted-content PDF host not executed |
| A13 | PASS | Policy gate + dedicated CODEX_HOME on host; no Node companion | [s2.md](s2.md) | Public download isolation attributes NOT RUN |
| A14 | PASS | `config/read` effective-policy gate on host | [s2.md](s2.md) | — |
| A15 | PASS | Typed usage-limit copy; drafts/history kept | [s2.md](s2.md), [s3.md](s3.md) | Missing-runtime reinstall path not re-run this matrix |
| A16 | PASS | Three disable/enable cycles (S1); later stages also disable/enable | [s0-s1.md](s0-s1.md), [s3.md](s3.md), [s5.md](s5.md) | S1 XPI was an earlier hash |
| A17 | PASS | TERM owned process; error UI; reopen handshake; log/store unit corruption cases | [s5.md](s5.md), unit | Power-loss durability NOT RUN |
| A18 | NOT RUN | Composer readable; system font chrome | [s4.md](s4.md) | IME host and live theme A26 not executed |
| A19 | NOT RUN | GitHub download + Node-free machine + host version-bump upgrade | [s6.md](s6.md) | Local two-version host a1→a2→a1 passed; GitHub download and Node-free machine were not this case |
| A20 | NOT RUN | Development XPI `verify:artifacts` clean; 复制诊断 whitelist on host | [s4.md](s4.md), [s6.md](s6.md) | Public Release assets do not exist |
| A21 | PASS | Auto-start from packaged XPI; virgin-profile first install; disable stops process; version-bump host upgrade/rollback | [s2.md](s2.md), [s5.md](s5.md), [s6.md](s6.md) | Public download isolation attributes NOT RUN |
| A22 | NOT RUN | Login state restored across restart | [s2.md](s2.md) | Click-login / cancel / timeout host `--login` not executed |
| A23 | NOT RUN | Send with changed model/speed/effort | [s4.md](s4.md) | Quota |
| A24 | NOT RUN | Follow-up with new settings on same thread | [s4.md](s4.md) | Quota |
| A25 | PASS | Ten toolbar open/close cycles; Ask does not send | [s4.md](s4.md) | — |
| A26 | NOT RUN | Live dark/light theme vs search chrome | [s4.md](s4.md) | `extensions.zotero.theme` unread |
| A27 | PASS | auto / page-fit / page-width / fixed 1.25 / manual zoom / page-2 close | [s4.md](s4.md) | — |
| A28 | PASS | 1024 and 1440 CSS px; notes pane yields dock | [s4.md](s4.md) | 800 CSS px NOT RUN (macOS stuck at 927) |
| A29 | PASS | Bar above native popup; Ask drafts; native colors intact | [s3.md](s3.md), [s4.md](s4.md) | — |
| A30 | PASS | Top / left / right in-view and not covering popup | [s4.md](s4.md) | Bottom-edge NOT RUN (no visible spans) |

Second-tester independent install: NOT RUN. Intel Mac / Windows / Linux: not in support table.

Reading-quality set (definition / formula / anaphora / follow-up / pseudo-instruction): NOT RUN (quota).
