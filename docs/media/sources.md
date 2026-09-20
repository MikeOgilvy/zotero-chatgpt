# README media: what each file is

Short provenance for the images in the repository README. This is a record of what was actually
produced, not a product specification.

## Where it was made

- **Host**: Zotero 9.0.6 (`/Applications/Zotero.app`, version from its `Info.plist`), macOS, Apple
  Silicon, light theme.
- **Instance**: an isolated, dedicated profile and data directory,
  `.zotero-chatgpt-dev/context-runs/readme-media/{profile,data}`, launched with
  `-no-remote -profile ... -datadir ...`. The everyday Zotero profile was never opened, used, or
  captured.
- **Build under capture**: `dist/zotero-chatgpt-0.4.0a34-dev.xpi`, sha256
  `5c9ed57cb3e7269a9e64e604236cf5823afd3defbfe58f437b3fc96e653e55fa`, matching
  `packages/zotero/manifest.json` version `0.4.0a34`. This is the artifact that was installed in the
  isolated profile for these captures.
- **Model requests**: none. No Chat question was sent and no Agent request was made. The captures use
  only local UI state and a passage staged into the official composer before sending.

## Demo content

The paper in the images is synthetic and generated for this repository by
`.zotero-chatgpt-dev/readme-media/make-demo-paper.mjs` ("Learning from prediction errors", "Demo
Author / Demo Institute"). It carries no DOI, no real author, no real publication and no real data,
and it says so on its own first page. Its bibliography fields were imported from a synthetic BibTeX
entry, and the PDF was attached by hand in the isolated library.

## The files

### `overview.png`

- **Type**: real screenshot of the running product, not an illustration.
- **Content**: the isolated Zotero window at 1440x880 CSS px (captured at 2x), with the synthetic
  demo paper in the reader on the left and the plugin sidebar on the right at 480 CSS px. The sidebar
  is in Chat mode and hosts the real `chatgpt.com` page in its signed-out state; the sidebar's own
  chrome (the Chat/Agent switch, the paper tab, the two copy controls, and the first-run context
  disclosure) is the product's.
- **Processing**: captured with `screencapture -l <window id>`, cropped to the window, scaled once to
  1920 px wide. No content was retouched, added, or removed.
- **What it does not show**: any conversation, answer, or signed-in state. No question was asked.

### `chat-demo.gif`

- **Type**: real screen recording of the running product.
- **Content**: one continuous interaction in the isolated window. A sentence is selected in the PDF
  with a real drag, the plugin's own `Ask in sidechat` control is clicked, and the passage arrives in
  the official ChatGPT composer as a draft. The recording ends before anything is sent.
- **Why this is not a sent request**: in Chat mode the selection action routes `ask` to
  `official.stage()` in `packages/zotero/src/chat/official-chat.ts`, which writes the composer and
  never submits. The submitting control (`More details`) was deliberately never clicked.
- **Processing**: recorded with `ffmpeg` from `avfoundation` at 15 fps / 3024x1964, trimmed to 8.1 s
  (leading and trailing idle time only; the middle is continuous and is not sped up), scaled to
  1200 px wide, 12 fps, 224-colour palette, no dither, delta-optimised.
- **Note on the caption**: the still and the GIF both say the passage is shown before sending,
  because that is the state the recording ends in.

### `chat-demo-poster.png`

- **Type**: still frame from the same recording (not a separate capture).
- **Content**: the final state of `chat-demo.gif`, exported at 1600 px wide from the source video so
  the text stays sharp. Provided so the section is readable without playing the animation.

### `agent-workflow.svg` and `agent-workflow.png`

- **Type**: illustration. It is **not** a screenshot, and it is visibly labelled `ILLUSTRATED
  WORKFLOW` inside the image.
- **Content**: the four intended steps (ask, review, approve, apply) with the example request
  "Highlight the key passages." It shows how the flow is meant to work; it is not evidence that any
  of these steps ran. No Agent task was executed for this media, and no native write was performed.
- **Processing**: drawn by hand as a self-contained SVG (no script, no external font, no remote
  resource). `agent-workflow.png` is a 1600 px wide render of the same file made with
  `rsvg-convert`, kept in case a raster export is wanted; the README uses the SVG.

## Rebuilding

The working scripts and the raw captures are intentionally outside version control, under
`.zotero-chatgpt-dev/readme-media/`:

```sh
node .zotero-chatgpt-dev/readme-media/make-demo-paper.mjs      # regenerate the demo paper
.zotero-chatgpt-dev/readme-media/host.sh start                 # launch the isolated instance
.zotero-chatgpt-dev/readme-media/reset-and-record.sh rec/chat-demo.mp4
```

`host.sh` only ever starts or stops the process whose arguments name this exact tree. The
`runjs.sh`, `zjs.sh`, `domclick.sh`, `field.mjs`, `winlist`, `ocr`, and `mouse` helpers were written
for these captures; they drive the isolated instance only and are not part of the product.

## Rights

All media here is original work created for this repository and is covered by the repository's MIT
licence. The paper, its metadata and its figures are synthetic. No third-party screenshot, logo, or
user content is included. Nothing was uploaded to an external image host or compression service.
