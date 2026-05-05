import { execSync } from "node:child_process";
import type { GitHubPR, SprintConfig } from "./types.js";

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

const EXCLUDED_TITLE_PATTERNS = [
  /^Merge release\//i,
  /^Bump /i,
  /^\[Bot\]/i,
];

const EXCLUDED_AUTHORS = ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"];

export async function fetchMergedPRs(
  config: SprintConfig,
  repos: import("./types.js").RepoConfig[],
  githubAuthors: string[],
  startDate: string,
  endDate: string,
  verbose: boolean = false,
): Promise<GitHubPR[]> {
  const allPRs: GitHubPR[] = [];

  for (const repo of repos) {
    const repoFullName = `${config.githubOrg}/${repo.name}`;
    const authorQueries = githubAuthors
      .map((a) => `author:${a}`)
      .join(" ");

    const cmd = [
      "gh",
      "search",
      "prs",
      `--repo`,
      repoFullName,
      `--merged`,
      `--limit`,
      "200",
      `--json`,
      "number,title,url,body,closedAt,author,repository,labels",
      `--`,
      `merged:${startDate}..${endDate}`,
      authorQueries,
    ];

    if (verbose) {
      console.error(`[github] Running: ${cmd.join(" ")}`);
    }

    try {
      const output = execSync(cmd.join(" "), {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });

      const rawPRs: RawGitHubPR[] = JSON.parse(output);

      for (const raw of rawPRs) {
        if (isExcluded(raw)) continue;

        allPRs.push({
          number: raw.number,
          title: raw.title,
          url: raw.url,
          body: raw.body || "",
          closedAt: raw.closedAt,
          author: raw.author.login,
          repository: raw.repository.name,
          labels: raw.labels.map((l) => l.name),
        });
      }

      if (verbose) {
        console.error(
          `[github] ${repoFullName}: ${rawPRs.length} raw PRs, ${allPRs.length} after filtering`,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[github] Error fetching PRs from ${repoFullName}: ${msg}`);
    }
  }

  return allPRs;
}

function isExcluded(pr: RawGitHubPR): boolean {
  if (EXCLUDED_AUTHORS.includes(pr.author.login)) return true;
  return EXCLUDED_TITLE_PATTERNS.some((p) => p.test(pr.title));
}
