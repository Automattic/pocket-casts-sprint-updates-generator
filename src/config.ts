import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SprintConfig, ResolvedAuthors, HistoryEntry, SprintCadence } from "./types.js";
import { DEFAULT_CONFIG } from "./default-config.js";

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

  const config: SprintConfig = existsSync(fullPath)
    ? (JSON.parse(readFileSync(fullPath, "utf-8")) as SprintConfig)
    : structuredClone(DEFAULT_CONFIG);

  if (!config.githubOrg) throw new Error("Config missing 'githubOrg'");
  if (!config.repoPrefix) throw new Error("Config missing 'repoPrefix'");
  if (!config.teamKeyPlatformMap || Object.keys(config.teamKeyPlatformMap).length === 0)
    throw new Error("Config missing 'teamKeyPlatformMap'");
  if (!config.members || Object.keys(config.members).length === 0)
    throw new Error("Config missing 'members'");
  if (!config.defaultAuthor) throw new Error("Config missing 'defaultAuthor'");
  if (!config.members[config.defaultAuthor])
    throw new Error(`defaultAuthor '${config.defaultAuthor}' not found in members`);

  config.repoPlatformMap = config.repoPlatformMap ?? {};
  if (!config.ai) config.ai = { ...DEFAULT_CONFIG.ai };
  if (!config.sprint) config.sprint = { ...DEFAULT_CONFIG.sprint };

  return config;
}

export function saveConfig(config: SprintConfig): void {
  ensureConfigDir();
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
    const insertIdx = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    lines.splice(insertIdx, 0, `${key}=${value}`);
  }

  writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
}

export function resolveAuthors(config: SprintConfig, authorFlag?: string): ResolvedAuthors {
  if (!authorFlag || authorFlag === "all") {
    return { githubAuthors: Object.keys(config.members) };
  }
  if (!config.members[authorFlag]) {
    const available = Object.keys(config.members).join(", ");
    throw new Error(`Unknown author '${authorFlag}'. Available: ${available}, all`);
  }
  return { githubAuthors: [authorFlag] };
}

export function filterRepos(discovered: string[], reposFlag?: string): string[] {
  if (!reposFlag) return discovered;
  const requested = reposFlag.split(",").map((r) => r.trim());
  const resolved: string[] = [];
  for (const name of requested) {
    if (!discovered.includes(name)) {
      throw new Error(`Repo '${name}' not found among discovered repos: ${discovered.join(", ")}`);
    }
    resolved.push(name);
  }
  return resolved;
}

export function getDefaultDateRange(sprint?: SprintCadence): { startDate: string; endDate: string } {
  if (!sprint) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);
    return { startDate: formatDate(start), endDate: formatDate(end) };
  }

  const anchor = new Date(sprint.anchorDate + "T00:00:00");
  const durationMs = sprint.durationWeeks * 7 * 24 * 60 * 60 * 1000;
  const now = new Date();

  let sprintStart = new Date(anchor);
  if (now >= anchor) {
    while (sprintStart.getTime() + durationMs <= now.getTime()) {
      sprintStart = new Date(sprintStart.getTime() + durationMs);
    }
  } else {
    while (sprintStart > now) {
      sprintStart = new Date(sprintStart.getTime() - durationMs);
    }
  }

  const sprintEnd = new Date(sprintStart.getTime() + durationMs);
  return { startDate: formatDate(sprintStart), endDate: formatDate(sprintEnd) };
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

export function loadHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: HistoryEntry): void {
  ensureConfigDir();
  const history = loadHistory();
  const idx = history.findIndex(
    (h) => h.startDate === entry.startDate && h.endDate === entry.endDate,
  );
  if (idx !== -1) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }
  history.sort((a, b) => b.startDate.localeCompare(a.startDate));
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf-8");
}

export function getNextSprintWindow(sprint: SprintCadence): { startDate: string; endDate: string } {
  const current = getDefaultDateRange(sprint);
  const durationMs = sprint.durationWeeks * 7 * 24 * 60 * 60 * 1000;
  const nextStart = new Date(new Date(current.endDate + "T00:00:00").getTime());
  const nextEnd = new Date(nextStart.getTime() + durationMs);
  return { startDate: formatDate(nextStart), endDate: formatDate(nextEnd) };
}
