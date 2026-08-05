import { execSync } from "node:child_process";
import type { GitHubPR, SprintConfig } from "./types.js";
import { extractLinearRefs } from "./correlator.js";

interface RawGitHubPR {
  number: number;
  title: string;
  url: string;
  body: string;
  closedAt: string;
  author: { login: string };
  repository: { name: string; nameWithOwner: string };
  labels: Array<{ name: string }>;
}

interface RawRepo {
  name: string;
  isFork: boolean;
}

const EXCLUDED_TITLE_PATTERNS = [/^Merge release\//i, /^Bump /i, /^\[Bot\]/i];
const EXCLUDED_AUTHORS = ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"];

function runGh(args: string[], verbose: boolean): string {
  if (verbose) {
    console.error(`[github] Running: gh ${args.join(" ")}`);
  }
  return execSync(`gh ${args.join(" ")}`, {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60_000,
  });
}

export function repoPlatform(repoName: string): string {
  const n = repoName.toLowerCase();
  if (n.includes("android")) return "Android";
  if (n.includes("ios")) return "iOS";
  if (n.includes("web")) return "Web";
  if (n.includes("server") || n.includes("api") || n.includes("sync") || n.includes("node"))
    return "Server";
  return "Other";
}

export async function discoverRepos(
  config: SprintConfig,
  verbose: boolean = false,
): Promise<string[]> {
  const output = runGh(
    ["repo", "list", config.githubOrg, "--no-archived", "--source", "--limit", "300", "--json", "name,isFork"],
    verbose,
  );
  const repos: RawRepo[] = JSON.parse(output);
  const names = repos
    .filter((r) => !r.isFork && r.name.startsWith(config.repoPrefix))
    .map((r) => r.name)
    .sort();

  if (verbose) {
    console.error(`[github] Discovered ${names.length} repos: ${names.join(", ")}`);
  }
  return names;
}

export async function fetchMergedPRs(
  config: SprintConfig,
  repos: string[],
  githubAuthors: string[],
  startDate: string,
  endDate: string,
  verbose: boolean = false,
): Promise<GitHubPR[]> {
  const byUrl = new Map<string, GitHubPR>();
  const repoFlags = repos.flatMap((name) => ["-R", `${config.githubOrg}/${name}`]);

  for (const author of githubAuthors) {
    const args = [
      "search",
      "prs",
      ...repoFlags,
      "--author",
      author,
      "--merged",
      "--merged-at",
      `${startDate}..${endDate}`,
      "--limit",
      "1000",
      "--json",
      "number,title,url,body,closedAt,author,repository,labels",
    ];

    let rawPRs: RawGitHubPR[];
    try {
      rawPRs = JSON.parse(runGh(args, verbose));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[github] Error fetching PRs for author ${author}: ${msg}`);
      continue;
    }

    for (const raw of rawPRs) {
      if (isExcluded(raw)) continue;
      if (byUrl.has(raw.url)) continue;
      byUrl.set(raw.url, {
        number: raw.number,
        title: raw.title,
        url: raw.url,
        body: raw.body || "",
        closedAt: raw.closedAt,
        author: raw.author.login,
        repository: raw.repository.name,
        platform: repoPlatform(raw.repository.name),
        labels: raw.labels.map((l) => l.name),
        linearRefs: extractLinearRefs(raw.body || ""),
      });
    }
  }

  const prs = [...byUrl.values()];
  if (verbose) {
    console.error(`[github] ${prs.length} merged PRs after filtering across ${githubAuthors.length} authors`);
  }
  return prs;
}

function isExcluded(pr: RawGitHubPR): boolean {
  if (EXCLUDED_AUTHORS.includes(pr.author.login)) return true;
  return EXCLUDED_TITLE_PATTERNS.some((p) => p.test(pr.title));
}
