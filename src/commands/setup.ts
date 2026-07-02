import { createInterface, Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execSync } from "node:child_process";
import {
  saveConfig,
  saveEnvKey,
  ensureConfigDir,
  CONFIG_PATH,
  ENV_PATH,
} from "../config.js";
import { PROVIDER_DEFAULTS } from "../ai/provider.js";
import type { SprintConfig, MemberConfig, AIConfig, PromptConfig } from "../types.js";
import type { ProviderName } from "../ai/provider.js";

export async function setupAction(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("\nSprint Report Setup");
    console.log("=".repeat(40));
    console.log("");

    console.log("Step 1: Linear API Key");
    console.log("  Get one at: Linear > Settings > Account > Security & Access");
    const linearKey = (await rl.question("  Enter your Linear API key: ")).trim();
    if (!linearKey) {
      console.error("  Error: Linear API key is required.");
      return;
    }
    const linearResult = await validateLinearKey(linearKey);
    if (!linearResult.ok) {
      console.error(`  Error: ${linearResult.detail}`);
      return;
    }
    console.log(`  ✓ ${linearResult.detail}`);
    console.log("");

    console.log("Step 2: GitHub CLI");
    const ghResult = validateGitHub();
    if (!ghResult.ok) {
      console.error(`  Error: ${ghResult.detail}`);
      console.error("  Run 'gh auth login' to authenticate.");
      return;
    }
    console.log(`  ✓ ${ghResult.detail}`);
    console.log("");

    console.log("Step 3: AI Provider");
    const providerNames: ProviderName[] = ["anthropic", "groq", "openai", "ollama"];
    for (let i = 0; i < providerNames.length; i++) {
      console.log(`  ${i + 1}. ${PROVIDER_DEFAULTS[providerNames[i]].label}`);
    }
    const providerChoice = await rl.question("  Choose provider (1-4) [1]: ");
    const providerIdx = parseInt(providerChoice || "1", 10) - 1;
    const providerName = providerNames[providerIdx] ?? "anthropic";
    const providerMeta = PROVIDER_DEFAULTS[providerName];

    let aiEnvKey = "";
    let aiEnvValue = "";

    if (providerName === "ollama") {
      const ollamaUrl = (await rl.question("  Ollama URL [http://localhost:11434]: ")).trim();
      if (ollamaUrl) {
        aiEnvKey = "OLLAMA_URL";
        aiEnvValue = ollamaUrl;
      }
      process.env.OLLAMA_URL = ollamaUrl || "http://localhost:11434";
    } else {
      aiEnvKey = providerMeta.envKey;
      aiEnvValue = (await rl.question(`  Enter your ${providerMeta.label} API key: `)).trim();
      if (!aiEnvValue) {
        console.error(`  Error: API key is required for ${providerMeta.label}.`);
        return;
      }
      process.env[aiEnvKey] = aiEnvValue;
    }
    await validateProvider(providerName);

    const modelInput = await rl.question(`  Model [${providerMeta.defaultModel}]: `);
    const model = modelInput.trim() || providerMeta.defaultModel;
    const aiConfig: AIConfig = { provider: providerName, model };
    console.log("");

    console.log("Step 4: GitHub Organization");
    const githubOrg = (await rl.question("  GitHub org [Automattic]: ")).trim() || "Automattic";
    console.log("");

    console.log("Step 5: Repository Prefix");
    console.log("  All non-archived repos in the org starting with this prefix are scanned.");
    const repoPrefix = (await rl.question("  Repo prefix [pocket-casts]: ")).trim() || "pocket-casts";
    console.log("");

    console.log("Step 6: Linear Teams -> Platforms");
    console.log("  Fetching teams from Linear...");
    const teams = await fetchLinearTeams(linearKey);
    if (teams.length > 0) {
      const filter = (await rl.question("  Search teams (substring, or empty for all): ")).trim().toLowerCase();
      const filtered = filter
        ? teams.filter((t) => t.name.toLowerCase().includes(filter) || t.key.toLowerCase().includes(filter))
        : teams;
      for (const team of filtered) {
        console.log(`    ${team.key.padEnd(12)} ${team.name}`);
      }
    }
    const teamKeysInput = await rl.question("  Team keys to track (comma-separated): ");
    const teamKeys = teamKeysInput.split(",").map((k) => k.trim().toUpperCase()).filter(Boolean);
    if (teamKeys.length === 0) {
      console.error("  Error: At least one team key is required.");
      return;
    }
    const teamKeyPlatformMap: Record<string, string> = {};
    for (const key of teamKeys) {
      const guessed = guessPlatform(key);
      teamKeyPlatformMap[key] = (await rl.question(`  Platform for ${key} [${guessed}]: `)).trim() || guessed;
    }
    console.log("");

    console.log("Step 7: Team Members");
    const members: Record<string, MemberConfig> = {};
    let firstMember = "";
    while (true) {
      const username = (await rl.question("  GitHub username (or empty to finish): ")).trim();
      if (!username) break;
      const linear = (await rl.question(`  Linear handle for ${username}: `)).trim();
      const displayName = (await rl.question(`  Display name [${username}]: `)).trim() || username;
      members[username] = { linear, name: displayName };
      if (!firstMember) firstMember = username;
    }
    if (Object.keys(members).length === 0) {
      console.error("  Error: At least one team member is required.");
      return;
    }
    console.log("");

    console.log("Step 8: Default Author");
    const defaultAuthor = (
      await rl.question(`  Default author [${firstMember}] (${Object.keys(members).join(", ")}): `)
    ).trim() || firstMember;
    if (!members[defaultAuthor]) {
      console.error(`  Error: '${defaultAuthor}' is not in the members list.`);
      return;
    }
    console.log("");

    console.log("Step 9: Sprint Cadence");
    const anchorDate = (await rl.question("  A recent sprint start date (YYYY-MM-DD, Sunday): ")).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      console.error("  Error: Invalid date format. Use YYYY-MM-DD.");
      return;
    }
    const durationWeeks = parseInt((await rl.question("  Sprint duration in weeks [2]: ")).trim() || "2", 10);
    console.log("");

    console.log("Step 10: AI Prompt Customization (optional)");
    const additionalInstructions = (await rl.question("  Additional AI instructions (optional): ")).trim();
    const prompts: PromptConfig | undefined = additionalInstructions ? { additionalInstructions } : undefined;
    console.log("");

    const config: SprintConfig = {
      githubOrg,
      repoPrefix,
      teamKeyPlatformMap,
      members,
      defaultAuthor,
      ai: aiConfig,
      sprint: { anchorDate, durationWeeks },
      repoPlatformMap: {},
      ...(prompts ? { prompts } : {}),
    };

    ensureConfigDir();
    saveConfig(config);
    saveEnvKey("LINEAR_API_KEY", linearKey);
    if (aiEnvKey && aiEnvValue) {
      saveEnvKey(aiEnvKey, aiEnvValue);
    }

    console.log("Setup complete!");
    console.log(`  Config: ${CONFIG_PATH}`);
    console.log(`  Env:    ${ENV_PATH}`);
    console.log("");
    console.log("Run 'sprint-report status' to verify, or 'sprint-report generate' to create a report.");
  } finally {
    rl.close();
  }
}

export async function ensureCredentials(config: SprintConfig, needAiKey: boolean = true): Promise<void> {
  const providerMeta = PROVIDER_DEFAULTS[config.ai.provider];
  const needsLinear = !process.env.LINEAR_API_KEY;
  const needsAi = needAiKey && Boolean(providerMeta.envKey) && !process.env[providerMeta.envKey];
  if (!needsLinear && !needsAi) return;

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.error("\nFirst run: a couple of API keys are needed (saved to ~/.sprint-report/.env).\n");
    if (needsLinear) {
      await promptKey(rl, "LINEAR_API_KEY", "Linear API key (Linear > Settings > Security & Access)");
    }
    if (needsAi) {
      await promptKey(rl, providerMeta.envKey, `${providerMeta.label} API key`);
    }
    console.error("");
  } finally {
    rl.close();
  }
}

async function promptKey(rl: Interface, envKey: string, label: string): Promise<void> {
  const value = (await rl.question(`  Enter your ${label}: `)).trim();
  if (!value) {
    throw new Error(`${envKey} is required.`);
  }
  process.env[envKey] = value;
  saveEnvKey(envKey, value);
}

async function validateProvider(providerName: ProviderName): Promise<void> {
  try {
    const { createProvider } = await import("../ai/provider.js");
    const result = await (await createProvider(providerName)).validate();
    console.log(result.ok ? `  ✓ ${result.detail}` : `  Warning: ${result.detail}`);
  } catch (err) {
    console.error(`  Warning: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function validateLinearKey(key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query: "{ viewer { name organization { name } } }" }),
    });
    const json = (await response.json()) as {
      data?: { viewer?: { name: string; organization?: { name: string } } };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) return { ok: false, detail: json.errors[0].message };
    const viewer = json.data?.viewer;
    if (!viewer) return { ok: false, detail: "Could not fetch user info" };
    return { ok: true, detail: `Connected as "${viewer.name}" (${viewer.organization?.name ?? "unknown"})` };
  } catch (err) {
    return { ok: false, detail: `Connection failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function validateGitHub(): { ok: boolean; detail: string } {
  try {
    const output = execSync("gh auth status --hostname github.com 2>&1 || true", {
      encoding: "utf-8",
      timeout: 15_000,
    });
    const match = output.match(/Logged in to [^ ]+ account (\S+)/i) ?? output.match(/Logged in to [^ ]+ as (\S+)/i);
    if (match) return { ok: true, detail: `Authenticated as ${match[1].replace(/[()]/g, "")}` };
    return { ok: false, detail: "gh CLI is not authenticated" };
  } catch {
    return { ok: false, detail: "gh CLI is not authenticated" };
  }
}

async function fetchLinearTeams(apiKey: string): Promise<Array<{ key: string; name: string }>> {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query: "{ teams(first: 250) { nodes { key name } } }" }),
    });
    const json = (await response.json()) as { data?: { teams?: { nodes: Array<{ key: string; name: string }> } } };
    return (json.data?.teams?.nodes ?? []).sort((a, b) => a.key.localeCompare(b.key));
  } catch {
    return [];
  }
}

function guessPlatform(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("droid") || lower.includes("android")) return "Android";
  if (lower.includes("ios")) return "iOS";
  if (lower.includes("web")) return "Web";
  if (lower.includes("server") || lower.includes("api")) return "Server";
  return "Other";
}
