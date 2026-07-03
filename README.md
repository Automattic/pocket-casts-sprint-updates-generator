# Sprint Report Generator

CLI tool that generates biweekly sprint reports for the whole team. It is **GitHub-first**:
it scans every `pocket-casts*` repository in the org, collects the merged PRs authored by
each team member in the sprint window, then walks each PR back to its Linear ticket → project
→ parent initiative, and uses AI to produce a consolidated, human-readable report. Output is
HTML (for pasting into Google Docs) and Markdown (for terminal review).

Ships with a **built-in default config**, so a fresh clone works with no setup beyond pasting
two API keys on first run.

## How it works

1. **Discovers repositories** — lists all non-archived, non-fork repos in the org whose name
   starts with `pocket-casts` (nothing falls off a hand-maintained list).
2. **Fetches merged PRs** for every team member in the sprint window, across all discovered
   repos (one `gh search` per author, since `gh` ANDs repeated `author:` qualifiers).
3. **Extracts Linear references** from each PR body (`PCDROID-123` style IDs or `linear.app`
   issue URLs).
4. **Resolves tickets → projects → initiatives** via the Linear GraphQL API, also pulling each
   project's team, status, progress, parent initiative (name + overview URL), and the latest
   project update.
5. **Pairs orphan PRs** — PRs with no resolvable Linear project are matched to the best-fitting
   project by an AI step; unconfident ones fall into an "Other" section grouped by platform.
6. **Summarizes each project** with AI, folding the latest Linear project update into a
   sprint-focused paragraph, and assigns a status (`In Progress` / `Complete` / `Paused`).
7. **Groups by initiative** and outputs HTML + Markdown, recording the run in
   `~/.sprint-report/history.json`.

### Report structure

- **Top Items Shipped** — AI-selected headline items.
- **Per initiative** (linked to its Linear overview): one line per platform-specific project,
  with the platform name linked to that project's overview URL, its status, an AI summary, and
  the merged PRs as links. Projects with no initiative render as their own heading.
- **Other** — orphan PRs grouped by platform.

Platform comes from a project's Linear team (`PCDROID → Android`, etc.), disambiguated by the
PRs' repos when a project spans multiple platform teams.

## Prerequisites

### Node.js (v18+) and npm

```bash
brew install node        # or use nvm
node --version           # v18+
```

### GitHub CLI (`gh`)

Used to discover repos and fetch PRs. Authentication is handled entirely by the CLI.

```bash
brew install gh
gh auth login
```

### API keys

- **Linear** (required) — Linear > Settings > Account > Security & Access > Personal API Keys.
  Read-only is sufficient.
- **AI provider** (required unless you use `--no-ai`) — Anthropic by default (see
  [AI Providers](#ai-providers)).

## Quick start

```bash
git clone <repo-url> && cd pocket-casts-sprint-updates-generator
npm install

# Generate a report for the current sprint (whole team).
# On first run you'll be prompted for your Linear + Anthropic keys; the built-in
# default config supplies everything else.
npx tsx src/index.ts generate
```

### Global install (optional)

```bash
npm link
sprint-report generate
sprint-report status
```

## Configuration

The tool ships with a built-in default config (`src/default-config.ts`): org `Automattic`,
repo prefix `pocket-casts`, the team roster, the team-key → platform map, the sprint cadence,
and Anthropic as the AI provider. **No `config.json` is required** — if one is absent the
default is used.

### Credentials on first run

API keys are never baked in. On first run, if `LINEAR_API_KEY` (and the AI provider's key) are
missing, the tool prompts for just those and writes them to `~/.sprint-report/.env`. Nothing
else is asked.

### Customizing

Run the interactive wizard to override any of the defaults:

```bash
sprint-report setup
```

It walks through the Linear key, GitHub CLI check, AI provider, GitHub org, repo prefix, Linear
team → platform mapping, team members (GitHub login + Linear handle), default author, sprint
cadence, and optional extra AI instructions. Config is written to
`~/.sprint-report/config.json`, keys to `~/.sprint-report/.env`.

**Manual config** (`~/.sprint-report/config.json`):

```json
{
  "githubOrg": "Automattic",
  "repoPrefix": "pocket-casts",
  "teamKeyPlatformMap": {
    "PCDROID": "Android",
    "PCIOS": "iOS",
    "PCWEB": "Web",
    "PCSERVER": "Server"
  },
  "members": {
    "<github-login>": { "linear": "<linear-handle>", "name": "<display name>" }
  },
  "defaultAuthor": "<github-login>",
  "ai": { "provider": "anthropic", "model": "claude-sonnet-5" },
  "sprint": { "anchorDate": "2026-04-26", "durationWeeks": 2 }
}
```

`sprint.anchorDate` is any known sprint start date (a Sunday); the tool steps forward/backward
from it in `durationWeeks` increments to find each window.

**Custom AI prompts** (optional, under `prompts`): `projectSummary`, `topItems`, `orphanPairing`
fully override the built-in prompts; `additionalInstructions` is appended to all of them.

## Commands

### `sprint-report generate [options]`

Generate a sprint report. This is the default command (you can omit `generate`).

```bash
sprint-report                                  # current sprint, whole team
sprint-report generate --author philipjohn     # a single member
sprint-report generate --sprint-start 2026-06-21
sprint-report generate --repos pocket-casts-android,pocket-casts-ios
sprint-report generate --no-ai                 # fast, deterministic, no AI summaries
sprint-report generate --dry-run --verbose     # fetch + resolve stats only
```

| Flag | Default | Description |
|------|---------|-------------|
| `--sprint-start <date>` | current sprint | Override sprint start day (YYYY-MM-DD) |
| `--sprint-length <weeks>` | from config | Override sprint length in weeks |
| `--author <user>` | whole team | GitHub login for one member, or `all` |
| `--repos <names>` | all discovered | Comma-separated filter over discovered repos |
| `--config <path>` | `~/.sprint-report/config.json` | Config file override |
| `--output <path>` | `./sprint-report.html` | HTML output file path |
| `--format <fmt>` | `both` | `html`, `markdown`, or `both` |
| `--no-ai` | | Skip AI summarization, output raw grouped data |
| `--no-orphan-pairing` | | Skip AI pairing of orphan PRs; send them straight to Other |
| `--dry-run` | | Fetch data only, print stats |
| `--verbose` | | Print debug info for API/CLI calls |

### `sprint-report setup`

Interactive wizard to customize the config (see [Customizing](#customizing)).

### `sprint-report status`

Shows the active config (or notes the built-in default is in use), tests the AI, Linear, and
GitHub connections, and lists the team → platform map, members, sprint cadence, and recent
report history.

### `sprint-report reset`

Deletes `~/.sprint-report/` (config, keys, history) after confirmation. Run this if you have an
old-format `config.json` from a previous version — the tool then falls back to the built-in
default.

## AI Providers

Switch providers by editing `ai.provider` / `ai.model` in the config.

| Provider | Config value | Env var | Default model |
|----------|-------------|---------|---------------|
| Anthropic (default) | `"anthropic"` | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |
| Groq | `"groq"` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| OpenAI | `"openai"` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Ollama (local) | `"ollama"` | `OLLAMA_URL` (optional) | `llama3.2` |

Providers are called with request timeouts and rate-limit retries. Note: Groq's free tier
(12k tokens/minute) is too constrained for a full team sprint (100+ PRs) and will be slow or
fail; Anthropic is recommended for the whole-team report. Use `--no-ai` for a fast,
deterministic report with no summaries.

## Output

- **Markdown** is printed to stdout for quick review.
- **HTML** is written to `sprint-report.html` — open it, select all, copy, paste into Google Docs.

## Tests

```bash
npm test
```

## Project structure

```
src/
  index.ts              CLI entry point (subcommand dispatcher)
  config.ts             Config load/save, default fallback, resolvers, sprint math
  default-config.ts     Built-in zero-setup config (org, roster, team->platform map, AI, cadence)
  types.ts              Shared TypeScript interfaces
  github-client.ts      Repo discovery + merged-PR fetch via the gh CLI
  linear-client.ts      Ticket/project/initiative resolution via Linear GraphQL
  correlator.ts         PR ref extraction, PR->project bundling, initiative grouping, platform
  summarizer.ts         AI project summaries, orphan pairing, top items
  formatter.ts          HTML and Markdown output
  commands/
    generate.ts         Report generation pipeline
    setup.ts            Interactive wizard + first-run credential prompt
    status.ts           Config and connection health check
    reset.ts            Delete configuration
  ai/
    provider.ts         AIProvider interface and factory
    anthropic.ts        Anthropic provider (default)
    openai-compat.ts    Base for OpenAI-compatible APIs (Groq, OpenAI, Ollama)
    groq.ts / openai.ts / ollama.ts
  __tests__/            Unit tests
bin/
  sprint-report.js      Global CLI entrypoint
```
