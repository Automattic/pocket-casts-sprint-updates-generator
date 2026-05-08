import { createInterface } from "node:readline/promises";
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
import type { SprintConfig, RepoConfig, MemberConfig, AIConfig, PromptConfig } from "../types.js";
import type { ProviderName } from "../ai/provider.js";

export async function setupAction(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("\nSprint Report Setup");
    console.log("=".repeat(40));
    console.log("");

    // Step 1: Linear API Key
    console.log("Step 1: Linear API Key");
    console.log("  Get one at: Linear > Settings > Account > Security & Access");
    const linearKey = await rl.question("  Enter your Linear API key: ");
    if (!linearKey.trim()) {
      console.error("  Error: Linear API key is required.");
      return;
    }
    const linearResult = await validateLinearKey(linearKey.trim());
    if (!linearResult.ok) {
      console.error(`  Error: ${linearResult.detail}`);
      return;
    }
    console.log(`  ✓ ${linearResult.detail}`);
    console.log("");

    // Step 2: GitHub CLI
    console.log("Step 2: GitHub CLI");
    const ghResult = validateGitHub();
    if (!ghResult.ok) {
      console.error(`  Error: ${ghResult.detail}`);
      console.error("  Run 'gh auth login' to authenticate.");
      return;
    }
    console.log(`  ✓ ${ghResult.detail}`);
    console.log("");

    // Step 3: AI Provider
    console.log("Step 3: AI Provider");
    const providerNames: ProviderName[] = ["groq", "openai", "ollama", "anthropic"];
    for (let i = 0; i < providerNames.length; i++) {
      const p = providerNames[i];
      console.log(`  ${i + 1}. ${PROVIDER_DEFAULTS[p].label}`);
    }
    const providerChoice = await rl.question("  Choose provider (1-4) [1]: ");
    const providerIdx = parseInt(providerChoice || "1", 10) - 1;
    const providerName = providerNames[providerIdx] ?? "groq";
    const providerMeta = PROVIDER_DEFAULTS[providerName];

    let aiEnvKey = "";
    let aiEnvValue = "";

    if (providerName === "ollama") {
      const ollamaUrl = await rl.question("  Ollama URL [http://localhost:11434]: ");
      if (ollamaUrl.trim()) {
        aiEnvKey = "OLLAMA_URL";
        aiEnvValue = ollamaUrl.trim();
      }
      // Validate
      process.env.OLLAMA_URL = ollamaUrl.trim() || "http://localhost:11434";
      const { OllamaProvider } = await import("../ai/ollama.js");
      const ollamaProvider = new OllamaProvider();
      const ollamaResult = await ollamaProvider.validate();
      if (!ollamaResult.ok) {
        console.error(`  Warning: ${ollamaResult.detail}`);
        console.log("  Continuing anyway -- you can start Ollama later.");
      } else {
        console.log(`  ✓ ${ollamaResult.detail}`);
      }
    } else {
      aiEnvKey = providerMeta.envKey;
      const keyPrompt = `  Enter your ${providerMeta.label} API key: `;
      aiEnvValue = (await rl.question(keyPrompt)).trim();
      if (!aiEnvValue) {
        console.error(`  Error: API key is required for ${providerMeta.label}.`);
        return;
      }
      // Quick validation
      process.env[aiEnvKey] = aiEnvValue;
      console.log("  Validating...");
      try {
        const { createProvider } = await import("../ai/provider.js");
        const testProvider = await createProvider(providerName);
        const result = await testProvider.validate();
        if (result.ok) {
          console.log(`  ✓ ${result.detail}`);
        } else {
          console.error(`  Warning: ${result.detail}`);
          console.log("  Continuing anyway -- check the key later with 'sprint-report status'.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Warning: ${msg}`);
      }
    }

    const modelDefault = providerMeta.defaultModel;
    const modelInput = await rl.question(`  Model [${modelDefault}]: `);
    const model = modelInput.trim() || modelDefault;
    console.log("");

    const aiConfig: AIConfig = { provider: providerName, model };

    // Step 4: GitHub Organization
    console.log("Step 4: GitHub Organization");
    const githubOrg = (await rl.question("  GitHub org [Automattic]: ")).trim() || "Automattic";
    console.log("");

    // Step 5: Repositories
    console.log("Step 5: Repositories");
    const reposInput = await rl.question("  Repo names (comma-separated): ");
    const repoNames = reposInput
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (repoNames.length === 0) {
      console.error("  Error: At least one repo is required.");
      return;
    }

    const repos: RepoConfig[] = [];
    for (const name of repoNames) {
      const guessedPlatform = guessPlatform(name);
      const platform = (
        await rl.question(`  Platform for ${name} [${guessedPlatform}]: `)
      ).trim() || guessedPlatform;
      repos.push({ name, platform });
    }
    console.log("");

    // Step 6: Linear Team Keys
    console.log("Step 6: Linear Teams");
    console.log("  Fetching teams from Linear...");
    const teams = await fetchLinearTeams(linearKey.trim());
    if (teams.length > 0) {
      const filterInput = await rl.question("  Search teams (e.g., 'pocket' to filter, or empty to show all): ");
      const filter = filterInput.trim().toLowerCase();
      const filtered = filter
        ? teams.filter((t) => t.name.toLowerCase().includes(filter) || t.key.toLowerCase().includes(filter))
        : teams;

      if (filtered.length === 0) {
        console.log(`  No teams match '${filter}'.`);
      } else {
        console.log(`  Available teams${filter ? ` matching '${filter}'` : ""}:`);
        for (const team of filtered) {
          console.log(`    ${team.key.padEnd(12)} ${team.name}`);
        }
      }
      console.log("");
    }
    console.log("  Enter the team key prefixes to track (these appear in ticket IDs, e.g., PCDROID-123).");
    const teamKeysInput = await rl.question("  Team keys (comma-separated): ");
    const linearTeamKeys = teamKeysInput
      .split(",")
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean);
    if (linearTeamKeys.length === 0) {
      console.error("  Error: At least one team key is required.");
      return;
    }
    const selectedNames = linearTeamKeys.map((k) => {
      const team = teams.find((t) => t.key === k);
      return team ? `${k} (${team.name})` : k;
    });
    console.log(`  ✓ Selected: ${selectedNames.join(", ")}`);
    console.log("");

    // Step 7: Team Members
    console.log("Step 7: Team Members");
    const members: Record<string, MemberConfig> = {};
    let firstMember = "";

    while (true) {
      const username = (
        await rl.question("  GitHub username (or empty to finish): ")
      ).trim();
      if (!username) break;

      const email = (
        await rl.question(`  Linear email for ${username}: `)
      ).trim();
      if (!email) {
        console.error("  Email is required. Skipping.");
        continue;
      }

      const displayName = (
        await rl.question(`  Display name [${username}]: `)
      ).trim() || username;

      members[username] = { linearEmail: email, name: displayName };
      if (!firstMember) firstMember = username;
    }

    if (Object.keys(members).length === 0) {
      console.error("  Error: At least one team member is required.");
      return;
    }
    console.log("");

    // Step 8: Default Author
    console.log("Step 8: Default Author");
    const memberList = Object.keys(members).join(", ");
    const defaultAuthor = (
      await rl.question(`  Default author [${firstMember}] (${memberList}): `)
    ).trim() || firstMember;

    if (!members[defaultAuthor]) {
      console.error(`  Error: '${defaultAuthor}' is not in the members list.`);
      return;
    }
    console.log("");

    // Step 9: Sprint Cadence
    console.log("Step 9: Sprint Cadence");
    console.log("  The tool calculates sprint windows from a known start date.");
    const anchorDate = (
      await rl.question("  A recent sprint start date (YYYY-MM-DD, Sunday): ")
    ).trim();
    if (!anchorDate || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      console.error("  Error: Invalid date format. Use YYYY-MM-DD.");
      return;
    }
    const durationInput = (
      await rl.question("  Sprint duration in weeks [2]: ")
    ).trim();
    const durationWeeks = parseInt(durationInput || "2", 10);
    console.log(`  ✓ Sprints: ${durationWeeks}-week cycles starting from ${anchorDate}`);
    console.log("");

    // Step 10: AI Prompt Customization (optional)
    console.log("Step 10: AI Prompt Customization (optional)");
    console.log("  You can add extra instructions that will be appended to all AI prompts.");
    console.log("  Example: 'Focus on user-facing changes. Keep summaries concise.'");
    console.log("  Full prompt overrides can be set directly in config.json.");
    const additionalInstructions = (
      await rl.question("  Additional AI instructions (optional): ")
    ).trim();

    let promptsConfig: PromptConfig | undefined;
    if (additionalInstructions) {
      promptsConfig = { additionalInstructions };
      console.log("  ✓ Custom instructions saved.");
    } else {
      console.log("  Using default prompts.");
    }
    console.log("");

    // Save everything
    const config: SprintConfig = {
      githubOrg,
      repos,
      linearTeamKeys,
      members,
      defaultAuthor,
      ai: aiConfig,
      sprint: { anchorDate, durationWeeks },
      repoPlatformMap: {},
      ...(promptsConfig ? { prompts: promptsConfig } : {}),
    };

    ensureConfigDir();
    saveConfig(config);
    saveEnvKey("LINEAR_API_KEY", linearKey.trim());
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

async function validateLinearKey(
  key: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: key,
      },
      body: JSON.stringify({
        query: "{ viewer { name email organization { name } } }",
      }),
    });

    const json = (await response.json()) as {
      data?: { viewer?: { name: string; organization?: { name: string } } };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      return { ok: false, detail: json.errors[0].message };
    }

    const viewer = json.data?.viewer;
    if (!viewer) {
      return { ok: false, detail: "Could not fetch user info" };
    }

    const org = viewer.organization?.name ?? "unknown workspace";
    return { ok: true, detail: `Connected as "${viewer.name}" (${org})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `Connection failed: ${msg}` };
  }
}

function validateGitHub(): { ok: boolean; detail: string } {
  try {
    const output = execSync("gh auth status --hostname github.com 2>&1 || true", {
      encoding: "utf-8",
      timeout: 15_000,
    });
    const match = output.match(/Logged in to [^ ]+ account (\S+)/i)
      ?? output.match(/Logged in to [^ ]+ as (\S+)/i);
    if (match) {
      const username = match[1].replace(/[()]/g, "");
      return { ok: true, detail: `Authenticated as ${username}` };
    }
    return { ok: false, detail: "gh CLI is not authenticated" };
  } catch {
    return { ok: false, detail: "gh CLI is not authenticated" };
  }
}

async function fetchLinearTeams(
  apiKey: string,
): Promise<Array<{ key: string; name: string }>> {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: "{ teams(first: 250) { nodes { key name } } }",
      }),
    });
    const json = (await response.json()) as {
      data?: { teams?: { nodes: Array<{ key: string; name: string }> } };
    };
    const teams = json.data?.teams?.nodes ?? [];
    return teams.sort((a, b) => a.key.localeCompare(b.key));
  } catch {
    return [];
  }
}

function guessPlatform(repoName: string): string {
  const lower = repoName.toLowerCase();
  if (lower.includes("android")) return "Android";
  if (lower.includes("ios")) return "iOS";
  if (lower.includes("web")) return "Web";
  if (lower.includes("server") || lower.includes("api")) return "Server";
  return "Other";
}
