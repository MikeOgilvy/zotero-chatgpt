# Release process (not executed)

GitHub owner is unset. This file describes how a human would publish later. **Do not** run `gh release`, `git push`, or upload assets from an agent session unless the author explicitly asks.

## Current development artifact

- npm: `0.3.0-alpha.1`
- Zotero manifest: `0.3.0a1`
- File: `dist/zotero-codex-reader-0.3.0a1-dev.xpi`
- Channel: none (`update_url` is `https://zcr-dev.invalid/updates.json`)
- Planned first public tag (later): `0.1.0-alpha.1` prerelease, not this development preview number

## Dry-run

```sh
npm run release:dry-run
# or
node scripts/release.mjs --dry-run --out /tmp/zcr-release-plan.json --json
```

`--publish`, `--gh-release`, and `--upload` are refused.

## Author checklist (future)

1. Confirm GitHub owner and create `zotero-codex-reader`.
2. Choose LICENSE with the third-party runtime/fonts list.
3. Build from a clean checkout on macOS arm64; keep SHA256SUMS.
4. Attach one platform XPI to a **draft** GitHub prerelease; review notes.
5. Install from that download on a machine without Node/Codex CLI.
6. Only then mark prerelease; stable `updates.json` stays off until A01–A30 pass.

Ubuntu `Release dry-run` workflow runs unit checks and this script. It does not package Darwin Codex or upload files.
