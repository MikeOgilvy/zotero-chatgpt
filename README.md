# zotero-chatgpt

**Read papers. Stay in Zotero.**

Ask ChatGPT beside your paper. Let Agent handle highlights and library organization.

<!-- DEMO: Add a real demo video or GIF here. Keep it near the top; no lengthy introduction needed. -->

## One sidebar. Two ways to work.

| Mode | What it does | Powered by |
| --- | --- | --- |
| **Chat** | Understand papers, explain selections, and ask follow-up questions | Official ChatGPT website |
| **Agent · Experimental** | Highlight passages, fetch papers, and organize selected items with tags and collections | Codex |

**Chat does not call Codex or consume your Codex weekly quota.** Agent requests use Codex quota. ChatGPT’s own usage limits still apply.

## Start with a question

Open a PDF and ask about it. Available text from the current paper is included by default—no repeated copying or manual uploads.

> **Chat:** “Why does this step in the derivation work?”
>
> **Agent:** “Highlight the five most important passages and explain why.”

Preview and approve Agent’s changes before they are applied. Highlights become native Zotero annotations; organization updates your selected items—not just a list of suggestions.

Paper retrieval starts with a DOI or article link and attempts to download a legally available PDF. This workflow is still being refined; see [project status](docs/progress.md) for availability.

## Get started

Install the development `.xpi` → open a paper → open the sidebar → sign in and start asking.

No API key is needed for Chat. Agent requires separate Codex authorization. See the [development guide](docs/development.md) for installation and build instructions.

**Development preview.** The documented test baseline is macOS Apple Silicon / Zotero 9.0.6. See [project status](docs/progress.md) for current support and remaining work.

<details>
<summary>Context and data</summary>

PDF text is extracted locally. When you send a question, its context is sent to the corresponding service. You can disable automatic PDF context. Available text is not the same as the complete PDF or its page images.

Chat does not modify your Zotero library or automatically switch to Agent. Agent performs library operations only within the scope you approve.

</details>

---

[Product guide](docs/zotero-chatgpt-user-flow.md) · [Development guide](docs/development.md) · [Project status](docs/progress.md)

An independent community project. Not affiliated with or endorsed by Zotero or OpenAI.
