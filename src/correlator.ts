import type {
  LinearIssue,
  GitHubPR,
  ProjectGroup,
  CorrelatorResult,
  SprintConfig,
} from "./types.js";
import type { ProjectMeta } from "./linear-client.js";

const LINEAR_REF_PATTERNS = [
  /\b([A-Z]+-\d+)\b/g,
  /linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/g,
];

export function extractLinearRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const pattern of LINEAR_REF_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(regex)) {
      const ref = match[1] ?? match[0];
      refs.add(ref);
    }
  }
  return [...refs];
}

function normalizeUrl(url: string): string {
  return url
    .replace(/\/$/, "")
    .replace(/^https?:\/\//, "")
    .toLowerCase();
}

export function correlate(
  issues: LinearIssue[],
  prs: GitHubPR[],
  projectMetas: ProjectMeta[],
  config: SprintConfig,
): CorrelatorResult {
  // Build lookup maps
  const issueByIdentifier = new Map<string, LinearIssue>();
  const issuesByAttachmentUrl = new Map<string, LinearIssue>();

  for (const issue of issues) {
    issueByIdentifier.set(issue.identifier, issue);
    for (const url of issue.prUrls) {
      issuesByAttachmentUrl.set(normalizeUrl(url), issue);
    }
  }

  // Build project meta lookup
  const projectMetaByName = new Map<string, ProjectMeta>();
  for (const meta of projectMetas) {
    projectMetaByName.set(meta.name, meta);
  }

  // Track which PRs have been matched
  const matchedPRUrls = new Set<string>();

  // Track which PRs are associated with which issues
  const prsByIssueId = new Map<string, GitHubPR[]>();

  // Strategy 1: Match PRs by Linear attachment URLs
  for (const pr of prs) {
    const normalized = normalizeUrl(pr.url);
    const issue = issuesByAttachmentUrl.get(normalized);
    if (issue) {
      matchedPRUrls.add(pr.url);
      const existing = prsByIssueId.get(issue.identifier) ?? [];
      existing.push(pr);
      prsByIssueId.set(issue.identifier, existing);
    }
  }

  // Strategy 2: Match PRs by body references
  for (const pr of prs) {
    if (matchedPRUrls.has(pr.url)) continue;

    const refs = extractLinearRefs(pr.body);
    for (const ref of refs) {
      const issue = issueByIdentifier.get(ref);
      if (issue) {
        matchedPRUrls.add(pr.url);
        const existing = prsByIssueId.get(issue.identifier) ?? [];
        if (!existing.some((p) => p.url === pr.url)) {
          existing.push(pr);
        }
        prsByIssueId.set(issue.identifier, existing);
        break;
      }
    }
  }

  // Group issues by project
  const projectGroupMap = new Map<
    string,
    { issues: LinearIssue[]; prs: GitHubPR[]; meta: ProjectMeta | undefined }
  >();

  for (const issue of issues) {
    const projectName = issue.projectName ?? "__no_project__";
    if (!projectGroupMap.has(projectName)) {
      projectGroupMap.set(projectName, {
        issues: [],
        prs: [],
        meta: projectMetaByName.get(projectName),
      });
    }

    const group = projectGroupMap.get(projectName)!;
    group.issues.push(issue);

    const issuePrs = prsByIssueId.get(issue.identifier) ?? [];
    for (const pr of issuePrs) {
      if (!group.prs.some((p) => p.url === pr.url)) {
        group.prs.push(pr);
      }
    }
  }

  // Build ProjectGroup array (excluding __no_project__)
  const projectGroups: ProjectGroup[] = [];

  for (const [name, group] of projectGroupMap) {
    if (name === "__no_project__") continue;

    const platform = detectPlatform(group.prs, group.issues, config);
    // Get project URL from the first issue that has one
    const projectUrl = group.issues.find((i) => i.projectUrl)?.projectUrl ?? null;

    projectGroups.push({
      projectName: name,
      projectUrl,
      projectProgress: group.meta?.progress ?? null,
      projectState: group.meta?.state ?? null,
      projectDescription: group.meta?.description ?? null,
      projectTargetDate: group.meta?.targetDate ?? null,
      projectLatestUpdate: group.meta?.latestUpdate?.body ?? null,
      projectHealth: group.meta?.latestUpdate?.health ?? null,
      platform,
      issues: group.issues,
      prs: group.prs,
    });
  }

  // Sort projects: most issues first
  projectGroups.sort((a, b) => b.issues.length - a.issues.length);

  // Collect unmatched PRs
  const unmatchedPRs = prs.filter((pr) => !matchedPRUrls.has(pr.url));

  // Also add issues with no project to unmatched-like handling:
  // Their PRs that haven't been claimed by a project group go to unmatched
  const noProjectGroup = projectGroupMap.get("__no_project__");
  if (noProjectGroup) {
    for (const pr of noProjectGroup.prs) {
      if (!unmatchedPRs.some((p) => p.url === pr.url)) {
        unmatchedPRs.push(pr);
      }
    }
  }

  return { projectGroups, unmatchedPRs };
}

function detectPlatform(
  prs: GitHubPR[],
  issues: LinearIssue[],
  config: SprintConfig,
): string {
  // Derive platform from PR repos
  const platforms = new Set<string>();
  for (const pr of prs) {
    const platform = config.repoPlatformMap[pr.repository];
    if (platform) platforms.add(platform);
  }

  if (platforms.size === 1) return [...platforms][0];
  if (platforms.size > 1) return "Cross-platform";

  // Fall back to Linear team key prefix
  if (issues.length > 0) {
    const prefix = issues[0].identifier.split("-")[0];
    const teamKeyToPlatform: Record<string, string> = {};
    for (const repo of config.repos) {
      for (const key of config.linearTeamKeys) {
        if (key === prefix) {
          teamKeyToPlatform[key] = repo.platform;
        }
      }
    }
    if (teamKeyToPlatform[prefix]) return teamKeyToPlatform[prefix];
  }

  return config.repos[0]?.platform ?? "Unknown";
}
