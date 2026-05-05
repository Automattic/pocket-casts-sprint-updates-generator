import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SprintConfig, RepoConfig, ResolvedAuthors, HistoryEntry } from "./types.js";

export const CONFIG_DIR = join(homedir(), ".sprint-report");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const ENV_PATH = join(CONFIG_DIR, ".env");
export const HISTORY_PATH = join(CONFIG_DIR, "history.json");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadEnv(envPath?: string): void {
  const path = envPath ?? ENV_PATH;
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(configPath?: string): SprintConfig {
  const fullPath = configPath ? resolve(configPath) : CONFIG_PATH;

  if (!existsSync(fullPath)) {
    throw new Error(
      `Config not found at ${fullPath}. Run 'sprint-report setup' to create it.`,
    );
  }

  const raw = readFileSync(fullPath, "utf-8");
  const config = JSON.parse(raw) as SprintConfig;

  if (!config.githubOrg) throw new Error("Config missing 'githubOrg'");
  if (!config.repos?.length) throw new Error("Config missing 'repos'");
  if (!config.linearTeamKeys?.length)
    throw new Error("Config missing 'linearTeamKeys'");
  if (!config.members || Object.keys(config.members).length === 0)
    throw new Error("Config missing 'members'");
  if (!config.defaultAuthor)
    throw new Error("Config missing 'defaultAuthor'");
  if (!config.members[config.defaultAuthor])
    throw new Error(
      `defaultAuthor '${config.defaultAuthor}' not found in members`,
    );

  // Auto-build repoPlatformMap from repos
  config.repoPlatformMap = {};
  for (const repo of config.repos) {
    config.repoPlatformMap[repo.name] = repo.platform;
  }

  // Default AI config
  if (!config.ai) {
    config.ai = { provider: "groq", model: "llama-3.3-70b-versatile" };
  }

  // Default sprint cadence
  if (!config.sprint) {
    config.sprint = { anchorDate: "2026-04-26", durationWeeks: 2 };
  }

  return config;
}

export function saveConfig(config: SprintConfig): void {
  ensureConfigDir();
  // Don't persist the auto-derived repoPlatformMap
  const { repoPlatformMap, ...toSave } = config;
  writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2) + "\n", "utf-8");
}

export function saveEnvKey(key: string, value: string): void {
  ensureConfigDir();
  let content = "";
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, "utf-8");
  }

  const lines = content.split("\n");
  const pattern = new RegExp(`^${key}=`);
  const idx = lines.findIndex((l) => pattern.test(l.trim()));

  if (idx !== -1) {
    lines[idx] = `${key}=${value}`;
  } else {
    // Append to end (before trailing empty lines)
    const insertIdx = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    lines.splice(insertIdx, 0, `${key}=${value}`);
  }

  writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
}

export function resolveAuthors(
  config: SprintConfig,
  authorFlag?: string,
): ResolvedAuthors {
  if (!authorFlag || authorFlag === config.defaultAuthor) {
    const member = config.members[config.defaultAuthor];
    return {
      githubAuthors: [config.defaultAuthor],
      linearEmails: [member.linearEmail],
    };
  }

  if (authorFlag === "all") {
    const usernames = Object.keys(config.members);
    return {
      githubAuthors: usernames,
      linearEmails: usernames.map((u) => config.members[u].linearEmail),
    };
  }

  const member = config.members[authorFlag];
  if (!member) {
    const available = Object.keys(config.members).join(", ");
    throw new Error(
      `Unknown author '${authorFlag}'. Available: ${available}, all`,
    );
  }

  return {
    githubAuthors: [authorFlag],
    linearEmails: [member.linearEmail],
  };
}

export function resolveRepos(
  config: SprintConfig,
  reposFlag?: string,
): RepoConfig[] {
  if (!reposFlag) return config.repos;

  const requested = reposFlag.split(",").map((r) => r.trim());
  const resolved: RepoConfig[] = [];

  for (const name of requested) {
    const repo = config.repos.find((r) => r.name === name);
    if (!repo) {
      const available = config.repos.map((r) => r.name).join(", ");
      throw new Error(`Unknown repo '${name}'. Available: ${available}`);
    }
    resolved.push(repo);
  }

  return resolved;
}

export function getDefaultDateRange(sprint?: import("./types.js").SprintCadence): { startDate: string; endDate: string } {
  if (!sprint) {
    // Fallback: last 14 days
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);
    return { startDate: formatDate(start), endDate: formatDate(end) };
  }

  const anchor = new Date(sprint.anchorDate + "T00:00:00");
  const durationMs = sprint.durationWeeks * 7 * 24 * 60 * 60 * 1000;
  const now = new Date();

  // Find the current sprint: step forward from anchor in durationWeeks increments
  // until we find the sprint that contains today
  let sprintStart = new Date(anchor);

  if (now >= anchor) {
    // Move forward from anchor
    while (sprintStart.getTime() + durationMs <= now.getTime()) {
      sprintStart = new Date(sprintStart.getTime() + durationMs);
    }
  } else {
    // Move backward from anchor
    while (sprintStart > now) {
      sprintStart = new Date(sprintStart.getTime() - durationMs);
    }
  }

  const sprintEnd = new Date(sprintStart.getTime() + durationMs);

  return {
    startDate: formatDate(sprintStart),
    endDate: formatDate(sprintEnd),
  };
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

// --- Report History ---

export function loadHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    const raw = readFileSync(HISTORY_PATH, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: HistoryEntry): void {
  ensureConfigDir();
  const history = loadHistory();
  // Replace if same sprint window already exists
  const idx = history.findIndex(
    (h) => h.startDate === entry.startDate && h.endDate === entry.endDate,
  );
  if (idx !== -1) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }
  // Sort by start date descending (newest first)
  history.sort((a, b) => b.startDate.localeCompare(a.startDate));
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf-8");
}

export function getNextSprintWindow(sprint: import("./types.js").SprintCadence): { startDate: string; endDate: string } {
  const current = getDefaultDateRange(sprint);
  const durationMs = sprint.durationWeeks * 7 * 24 * 60 * 60 * 1000;
  const nextStart = new Date(new Date(current.endDate + "T00:00:00").getTime());
  const nextEnd = new Date(nextStart.getTime() + durationMs);
  return { startDate: formatDate(nextStart), endDate: formatDate(nextEnd) };
}
