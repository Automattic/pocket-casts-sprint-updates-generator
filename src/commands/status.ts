import { execSync } from "node:child_process";
import {
  loadConfig,
  loadEnv,
  configExists,
  maskKey,
  getDefaultDateRange,
  getNextSprintWindow,
  loadHistory,
  CONFIG_PATH,
  ENV_PATH,
} from "../config.js";
import { createProvider, PROVIDER_DEFAULTS } from "../ai/provider.js";

export async function statusAction(): Promise<void> {
  console.log("\nSprint Report Configuration");
  console.log("=".repeat(40));
  console.log("");

  // Config file
  console.log(`Config:  ${CONFIG_PATH}`);
  console.log(`Env:     ${ENV_PATH}`);
  console.log("");

  if (!configExists()) {
    console.log("No config file found -- using built-in default config.");
    console.log("Run 'sprint-report setup' to customize.");
    console.log("");
  }

  loadEnv();
  const config = loadConfig();

  // AI Provider
  const providerName = config.ai?.provider ?? "anthropic";
  const providerLabel = PROVIDER_DEFAULTS[providerName]?.label ?? providerName;
  const model = config.ai?.model ?? PROVIDER_DEFAULTS[providerName]?.defaultModel ?? "unknown";
  console.log(`AI Provider: ${providerLabel} (${model})`);

  const envKey = PROVIDER_DEFAULTS[providerName]?.envKey;
  if (envKey && providerName !== "ollama") {
    const keyValue = process.env[envKey];
    if (keyValue) {
      try {
        const provider = await createProvider(providerName, model);
        const result = await provider.validate();
        const masked = maskKey(keyValue);
        const status = result.ok ? "✓ connected" : `✗ ${result.detail}`;
        console.log(`  API Key: ${masked} ${status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  API Key: ✗ ${msg}`);
      }
    } else {
      console.log(`  API Key: ✗ ${envKey} not set`);
    }
  } else if (providerName === "ollama") {
    try {
      const provider = await createProvider("ollama", model);
      const result = await provider.validate();
      const status = result.ok ? "✓ connected" : `✗ ${result.detail}`;
      console.log(`  Ollama: ${status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Ollama: ✗ ${msg}`);
    }
  }
  console.log("");

  // Linear
  console.log("Linear:");
  const linearKey = process.env.LINEAR_API_KEY;
  if (linearKey) {
    const masked = maskKey(linearKey);
    try {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: linearKey,
        },
        body: JSON.stringify({
          query: "{ viewer { name organization { name } } }",
        }),
      });
      const json = (await response.json()) as {
        data?: { viewer?: { name: string; organization?: { name: string } } };
      };
      const viewer = json.data?.viewer;
      if (viewer) {
        const org = viewer.organization?.name ?? "unknown";
        console.log(`  API Key: ${masked} ✓ connected (${org})`);
      } else {
        console.log(`  API Key: ${masked} ✗ invalid response`);
      }
    } catch {
      console.log(`  API Key: ${masked} ✗ connection failed`);
    }
  } else {
    console.log("  API Key: ✗ LINEAR_API_KEY not set");
  }
  const teamMap = Object.entries(config.teamKeyPlatformMap)
    .map(([key, platform]) => `${key}→${platform}`)
    .join(", ");
  console.log(`  Teams:   ${teamMap}`);
  console.log("");

  // GitHub
  console.log("GitHub:");
  try {
    const output = execSync("gh auth status --hostname github.com 2>&1 || true", {
      encoding: "utf-8",
      timeout: 15_000,
    });
    const match = output.match(/Logged in to [^ ]+ account (\S+)/i)
      ?? output.match(/Logged in to [^ ]+ as (\S+)/i);
    if (match) {
      const username = match[1].replace(/[()]/g, "");
      console.log(`  CLI Auth: ✓ authenticated as ${username}`);
    } else {
      console.log("  CLI Auth: ✗ not authenticated (run 'gh auth login')");
    }
  } catch {
    console.log("  CLI Auth: ✗ not authenticated (run 'gh auth login')");
  }
  console.log(`  Org:      ${config.githubOrg}`);
  console.log(`  Repos:    ${config.repoPrefix}* (discovered at runtime)`);
  console.log("");

  // Members
  console.log("Members:");
  for (const [username, member] of Object.entries(config.members)) {
    const isDefault = username === config.defaultAuthor ? " [default]" : "";
    console.log(`  ${username.padEnd(16)} → ${member.linear} (${member.name})${isDefault}`);
  }
  console.log("");

  // Sprint Cadence
  if (config.sprint) {
    const { startDate, endDate } = getDefaultDateRange(config.sprint);
    const next = getNextSprintWindow(config.sprint);
    console.log("Sprint:");
    console.log(`  Cadence:  ${config.sprint.durationWeeks}-week cycles (anchor: ${config.sprint.anchorDate})`);
    console.log(`  Current:  ${startDate} → ${endDate}`);
    console.log(`  Next:     ${next.startDate} → ${next.endDate}`);
    console.log("");
  }

  // Report History
  const history = loadHistory();
  if (history.length > 0) {
    console.log("Report History (recent):");
    for (const entry of history.slice(0, 5)) {
      const date = entry.generatedAt.split("T")[0];
      console.log(
        `  ${entry.startDate} → ${entry.endDate}  (generated ${date}, author: ${entry.author}, ${entry.projectCount} projects, ${entry.prCount} PRs, ${entry.issueCount} issues)`,
      );
    }
    if (history.length > 5) {
      console.log(`  ... and ${history.length - 5} more (see ~/.sprint-report/history.json)`);
    }
    console.log("");
  }
}
