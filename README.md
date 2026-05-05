# Sprint Report Generator

CLI tool that generates biweekly sprint reports by pulling data from Linear and GitHub, correlating tickets with PRs, and using AI to produce human-readable summaries. Output is formatted as HTML (for pasting into Google Docs) and Markdown (for terminal review).

## How it works

1. Fetches completed Linear tickets for the current sprint (with descriptions, project info, and linked PR attachments)
2. Fetches Linear project metadata -- description, progress, target date, health status, and the latest project update written by the team
3. Fetches merged GitHub PRs in the same sprint window
4. Correlates PRs to Linear issues via attachment URLs and PR body references (e.g., `PCDROID-123`)
5. Groups everything by Linear project, with unmatched PRs in an "Other" section
6. Sends grouped data (including project updates and descriptions) to your configured AI provider to generate context-aware per-project summaries and top shipped items
7. Outputs HTML to a file and Markdown to the terminal
8. Records the report in `~/.sprint-report/history.json` for future reference

## Prerequisites

The following tools must be installed before setting up the sprint report generator.

### Node.js (v18+) and npm

**macOS (Homebrew):**
```bash
brew install node
```

**macOS (nvm -- recommended if you manage multiple Node versions):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22
```

**Verify:**
```bash
node --version   # v18.0.0 or higher
npm --version
```

### GitHub CLI (`gh`)

Used to fetch pull request data. No GitHub token setup needed -- the CLI handles authentication.

**macOS (Homebrew):**
```bash
brew install gh
```

**Other platforms:** see [cli.github.com](https://cli.github.com/)

**Authenticate after install:**
```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account. The setup wizard will verify this is working.

## Quick Start

```bash
# Clone and install dependencies
git clone <repo-url> && cd pocket-casts-sprint-updates-generator
npm install

# Run the interactive setup wizard
npx tsx src/index.ts setup

# Generate your first report
npx tsx src/index.ts generate
```

### Global install (optional)

```bash
npm link
# Now you can run from anywhere:
sprint-report setup
sprint-report generate
sprint-report status
```

## Setup

### Interactive wizard

The easiest way to configure the tool:

```bash
sprint-report setup
```

This walks you through:

1. **Linear API key** -- validates the key live, shows your workspace name
2. **GitHub CLI** -- checks `gh auth status` (must already be logged in via `gh auth login`)
3. **AI provider** -- choose from Groq (free), OpenAI, Ollama (local), or Anthropic
4. **GitHub organization** -- e.g., `Automattic`
5. **Repositories** -- which repos to track, with platform labels
6. **Linear team keys** -- the prefixes in your ticket IDs (e.g., `PCDROID`)
7. **Team members** -- GitHub username + Linear email for each person
8. **Default author** -- who reports are generated for by default
9. **Sprint cadence** -- a known sprint start date (Sunday) and duration in weeks

Config is saved to `~/.sprint-report/config.json` and API keys to `~/.sprint-report/.env`.

### Manual setup

If you prefer to create the config manually:

**~/.sprint-report/config.json:**

```json
{
  "githubOrg": "Automattic",
  "repos": [
    { "name": "pocket-casts-android", "platform": "Android" }
  ],
  "linearTeamKeys": ["PCDROID"],
  "members": {
    "<user-tag>": { "linearEmail": "<your-linear-email>@a8c.com", "name": "<your-name>" }
  },
  "defaultAuthor": "<github-author>",
  "ai": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile"
  },
  "sprint": {
    "anchorDate": "2026-04-26",
    "durationWeeks": 2
  }
}
```

The `sprint.anchorDate` is any known sprint start date (a Sunday). The tool calculates all sprint windows by stepping forward/backward from this anchor in `durationWeeks` increments.

**~/.sprint-report/.env:**

```
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
```

### Getting API keys

**Linear** (required):
- Linear > Settings > Account > Security & Access > Personal API Keys
- Read-only permission is sufficient

**GitHub** (no extra key needed):
- Uses your existing `gh` CLI authentication
- Run `gh auth login` if not already set up

**AI Provider** (pick one):

| Provider | Free? | How to get a key |
|----------|-------|------------------|
| Groq | Yes | [console.groq.com](https://console.groq.com) -- sign in with Google/GitHub |
| OpenAI | No | [platform.openai.com](https://platform.openai.com) |
| Ollama | Yes | No key needed -- [install Ollama](https://ollama.com), then `ollama pull llama3.2` |
| Anthropic | No | [console.anthropic.com](https://console.anthropic.com) |

## Commands

### `sprint-report setup`

Interactive setup wizard. Validates each credential as you enter it. During Linear team selection, the wizard fetches all available teams from your workspace so you can search and pick the ones to track.

### `sprint-report reset`

Deletes all configuration, API keys, and report history (`~/.sprint-report/` directory). Asks for confirmation before proceeding.

```bash
sprint-report reset
# This will delete all sprint-report configuration:
#   ~/.sprint-report/config.json
#   ~/.sprint-report/.env
#   ~/.sprint-report/history.json
#
# Are you sure? (yes/no): yes
# Deleted ~/.sprint-report
# Run 'sprint-report setup' to start fresh.
```

### `sprint-report status`

Shows your current configuration, tests all connections, and displays sprint cadence and report history:

```
Sprint Report Configuration
========================================

Config:  ~/.sprint-report/config.json
Env:     ~/.sprint-report/.env

AI Provider: Groq (free) (llama-3.3-70b-versatile)
  API Key: gsk_...mqFt ✓ connected

Linear:
  API Key: lin_...CsO ✓ connected (a8c)
  Teams:   PCDROID

GitHub:
  CLI Auth: ✓ authenticated as sztomek
  Org:      Automattic
  Repos:    pocket-casts-android (Android)

Members:
  sztomek          → tamas.szelezsan@a8c.com (Tamas) [default]

Sprint:
  Cadence:  2-week cycles (anchor: 2026-04-26)
  Current:  2026-04-26 → 2026-05-10
  Next:     2026-05-10 → 2026-05-24

Report History (recent):
  2026-04-26 → 2026-05-10  (generated 2026-05-05, author: sztomek, 3 projects, 8 PRs, 12 issues)
```

### `sprint-report generate [options]`

Generate a sprint report. This is the default command (you can omit `generate`).

```bash
# Report for the current sprint (auto-calculated from config cadence)
sprint-report generate

# Or just:
sprint-report

# Report for a specific sprint by start date
sprint-report generate --sprint-start 2026-04-12

# Report with a custom sprint length
sprint-report generate --sprint-start 2026-04-12 --sprint-length 1

# Report for a specific team member
sprint-report generate --author philipjohn

# Report for the entire team
sprint-report generate --author all

# Filter to specific repos
sprint-report generate --repos pocket-casts-android,pocket-casts-ios

# Skip AI summaries
sprint-report generate --no-ai

# Dry run (fetch data only)
sprint-report generate --dry-run

# Markdown only
sprint-report generate --format markdown

# Debug logging
sprint-report generate --verbose
```

#### Generate options

| Flag | Default | Description |
|------|---------|-------------|
| `--sprint-start <date>` | current sprint | Override sprint start day (YYYY-MM-DD) |
| `--sprint-length <weeks>` | from config | Override sprint length in weeks |
| `--author <user>` | `defaultAuthor` | GitHub username, or `all` for entire team |
| `--repos <names>` | all repos | Comma-separated repo names |
| `--config <path>` | `~/.sprint-report/config.json` | Config file override |
| `--output <path>` | `./sprint-report.html` | HTML output file path |
| `--format <fmt>` | `both` | `html`, `markdown`, or `both` |
| `--no-ai` | | Skip AI summarization |
| `--dry-run` | | Fetch data only, print stats |
| `--verbose` | | Print debug info for API calls |

### Output

- **Markdown** is printed to stdout for quick terminal review
- **HTML** is written to `sprint-report.html` -- open in a browser, select all, copy, paste into Google Docs

## AI Providers

The tool supports multiple AI providers via a plugin system. Switch providers by editing `~/.sprint-report/config.json`:

```json
{
  "ai": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile"
  }
}
```

| Provider | Config value | Env var | Default model |
|----------|-------------|---------|---------------|
| Groq | `"groq"` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| OpenAI | `"openai"` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Ollama | `"ollama"` | `OLLAMA_URL` (optional) | `llama3.2` |
| Anthropic | `"anthropic"` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |

Groq, OpenAI, and Ollama all use the OpenAI-compatible chat completions format. Anthropic uses its own messages API.

### What data does the AI receive?

For each project, the AI is given:

- **Project description** -- the overall goal from Linear
- **Latest project update** -- the most recent status update written by the team in Linear (the weekly updates you post on Fridays)
- **Project health** -- onTrack, atRisk, or offTrack
- **Target date** -- when the project is expected to ship
- **Progress** -- completion percentage
- **Completed tickets** -- title, description, and status of each Linear issue closed this sprint
- **Merged PRs** -- title, URL, and description of each GitHub PR merged this sprint

The AI uses the latest project update for broader context (where things stand overall) while focusing the summary on the current sprint's work. This means your weekly Linear project updates directly improve the quality of generated reports.

## Report History

Every `generate` run (except `--dry-run`) is recorded in `~/.sprint-report/history.json`. This tracks which sprints have been reported on, when, and basic stats. View recent history with `sprint-report status`.

## Tests

```bash
npm test
```

## Project structure

```
src/
  index.ts              CLI entry point (subcommand dispatcher)
  config.ts             Global config (~/.sprint-report/), save/load, resolvers
  types.ts              Shared TypeScript interfaces
  summarizer.ts         AI summarization (provider-agnostic)
  correlator.ts         Matches PRs to Linear issues, groups by project
  github-client.ts      Fetches merged PRs via gh CLI
  linear-client.ts      Fetches completed issues via Linear GraphQL API
  formatter.ts          HTML and Markdown output formatting
  commands/
    setup.ts            Interactive setup wizard
    status.ts           Config and connection health check
    generate.ts         Report generation logic
  ai/
    provider.ts         AIProvider interface and factory
    openai-compat.ts    Base class for OpenAI-compatible APIs
    groq.ts             Groq provider
    openai.ts           OpenAI provider
    ollama.ts           Ollama provider (local)
    anthropic.ts        Anthropic provider
  __tests__/            Unit tests
bin/
  sprint-report.js      Global CLI entrypoint
```
