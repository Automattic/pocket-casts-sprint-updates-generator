import type { AIProvider } from "./ai/provider.js";
import type { ProjectGroup, ProjectSummary, TopItem, ReportItem } from "./types.js";

const PROJECT_SUMMARY_PROMPT = `You are a technical writer producing a biweekly sprint report for a podcast app team.

Given the following data about work completed in the "{projectName}" project during the sprint ({startDate} to {endDate}), produce:

1. A summary paragraph (2-4 sentences) describing what was accomplished this sprint. Mention specific features, bug fixes, or improvements. Use the ticket descriptions, PR descriptions, and the latest project update (if available) to understand context and write a meaningful update.
2. A status tag: exactly one of "Complete", "Nearly complete", "In Progress", "Started", "Blocked"

The data includes:
- projectDescription: the overall goal of the project
- latestProjectUpdate: the most recent status update written by the team (use this for tone and context)
- health: the project's health status (onTrack, atRisk, offTrack)
- targetDate: when the project is expected to ship
- issues: completed Linear tickets this sprint
- prs: merged pull requests this sprint

RULES:
- Be specific about what was accomplished -- reference concrete features, fixes, and changes
- Use past tense for completed work, present tense for ongoing work
- Reference specific features/fixes by name, not ticket numbers or PR numbers
- Do not invent information not present in the data
- The summary should read like a natural status update a team lead would write
- If a latestProjectUpdate is provided, use it for context about where the project stands overall -- but focus the summary on THIS sprint's work
- Base the status on project progress percentage and health: 100% = Complete, 80-99% = Nearly complete, 20-79% = In Progress, 1-19% = Started, 0% with blockers = Blocked. Health "offTrack" or "atRisk" can override to "Blocked" if appropriate.

Project data:
{projectData}

Respond ONLY with this exact JSON (no markdown, no code fences):
{"summary": "...", "status": "..."}`;

const TOP_ITEMS_PROMPT = `You are a technical writer selecting headline items for a biweekly sprint report.

Given these project summaries and uncategorized PRs from a sprint ({startDate} to {endDate}), select the top 3-5 most impactful items shipped.

Criteria for "top items":
- User-facing features or significant improvements
- Major bug fixes affecting many users
- Important infrastructure changes

Do NOT include: dependency bumps, minor refactors, CI changes, release merges, internal tooling.

Project summaries:
{projectSummaries}

Uncategorized PRs:
{uncategorizedPRs}

Respond ONLY with this exact JSON (no markdown, no code fences):
{"topItems": [{"headline": "...", "platform": "Android|iOS|Web|Server|Cross-platform"}, ...]}`;

function truncate(text: string, maxLen: number): string | undefined {
  if (!text || !text.trim()) return undefined;
  const cleaned = text.trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "...";
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return text;
}

export async function summarizeProject(
  group: ProjectGroup,
  startDate: string,
  endDate: string,
  provider: AIProvider,
): Promise<ProjectSummary> {
  const projectData = JSON.stringify(
    {
      projectName: group.projectName,
      projectDescription: group.projectDescription || undefined,
      progress: group.projectProgress,
      state: group.projectState,
      health: group.projectHealth || undefined,
      targetDate: group.projectTargetDate || undefined,
      latestProjectUpdate: truncate(group.projectLatestUpdate ?? "", 800) || undefined,
      platform: group.platform,
      issues: group.issues.map((i) => ({
        id: i.identifier,
        title: i.title,
        description: i.description || undefined,
        status: i.status,
      })),
      prs: group.prs.map((p) => ({
        title: p.title,
        url: p.url,
        description: truncate(p.body, 500),
      })),
    },
    null,
    2,
  );

  const prompt = PROJECT_SUMMARY_PROMPT
    .replace("{projectName}", group.projectName)
    .replace("{startDate}", startDate)
    .replace("{endDate}", endDate)
    .replace("{projectData}", projectData);

  const text = await provider.chat([{ role: "user", content: prompt }]);

  let parsed: { summary: string; status: string };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.error(`[summarizer] Failed to parse project summary for "${group.projectName}": ${text}`);
    parsed = {
      summary: `Work on ${group.projectName} (${group.issues.length} issues, ${group.prs.length} PRs)`,
      status: group.projectProgress && group.projectProgress >= 1 ? "Complete" : "In Progress",
    };
  }

  const items: ReportItem[] = [];

  for (const pr of group.prs) {
    const linkedIssue = group.issues.find((i) =>
      i.prUrls.some((u) => u.includes(String(pr.number))),
    );
    items.push({
      title: pr.title,
      url: pr.url,
      linearId: linkedIssue?.identifier ?? null,
    });
  }

  const prLinkedIssueIds = new Set(
    items.filter((i) => i.linearId).map((i) => i.linearId),
  );
  for (const issue of group.issues) {
    if (!prLinkedIssueIds.has(issue.identifier)) {
      items.push({
        title: issue.title,
        url: null,
        linearId: issue.identifier,
      });
    }
  }

  return {
    projectName: group.projectName,
    projectUrl: group.projectUrl,
    platform: group.platform,
    summary: parsed.summary,
    status: parsed.status as ProjectSummary["status"],
    items,
  };
}

export async function selectTopItems(
  projectSummaries: ProjectSummary[],
  uncategorizedPRs: ReportItem[],
  startDate: string,
  endDate: string,
  provider: AIProvider,
): Promise<TopItem[]> {
  const prompt = TOP_ITEMS_PROMPT
    .replace("{startDate}", startDate)
    .replace("{endDate}", endDate)
    .replace(
      "{projectSummaries}",
      JSON.stringify(
        projectSummaries.map((p) => ({
          project: p.projectName,
          platform: p.platform,
          summary: p.summary,
          status: p.status,
          items: p.items.map((i) => i.title),
        })),
        null,
        2,
      ),
    )
    .replace(
      "{uncategorizedPRs}",
      JSON.stringify(
        uncategorizedPRs.map((p) => ({ title: p.title, url: p.url })),
        null,
        2,
      ),
    );

  const text = await provider.chat([{ role: "user", content: prompt }]);

  try {
    const parsed = JSON.parse(extractJson(text)) as { topItems: TopItem[] };
    return parsed.topItems;
  } catch {
    console.error(`[summarizer] Failed to parse top items: ${text}`);
    return projectSummaries.slice(0, 3).map((p) => ({
      headline: p.summary,
      platform: p.platform,
    }));
  }
}

export function buildReportItemsFromPRs(prs: { title: string; url: string }[]): ReportItem[] {
  return prs.map((pr) => ({
    title: pr.title,
    url: pr.url,
    linearId: null,
  }));
}
