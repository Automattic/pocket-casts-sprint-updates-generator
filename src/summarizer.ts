import type { AIProvider } from "./ai/provider.js";
import type {
  GitHubPR,
  LinearProject,
  ProjectBundle,
  ReportProject,
  ReportPR,
  TopItem,
  PromptConfig,
} from "./types.js";

const PROJECT_SUMMARY_PROMPT = `You are a technical writer producing a biweekly sprint report for a podcast app team.

Given the following data about work done in the "{projectName}" project during the sprint ({startDate} to {endDate}), write a summary paragraph (1-2 sentences) describing what was accomplished this sprint. Mention specific features, bug fixes, or improvements.

The data includes:
- projectDescription: the overall goal of the project
- latestProjectUpdate: the most recent status update written by the team -- incorporate its substance into the summary, reworded to focus on this sprint's work
- health: the project's health status (onTrack, atRisk, offTrack)
- targetDate: when the project is expected to ship
- prs: merged pull requests this sprint

RULES:
- Be specific -- reference concrete features, fixes, and changes
- Use past tense for completed work, present tense for ongoing work
- Reference features/fixes by name, not ticket or PR numbers
- Do not invent information not present in the data
- Fold the latestProjectUpdate content directly into the paragraph when present
- Read like a natural status update a team lead would write

Project data:
{projectData}

Respond ONLY with this exact JSON (no markdown, no code fences):
{"summary": "..."}`;

const TOP_ITEMS_PROMPT = `You are a technical writer selecting headline items for a biweekly sprint report.

Given these project summaries and uncategorized PRs from a sprint ({startDate} to {endDate}), select the top 3 most impactful items shipped.

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

const ORPHAN_PAIRING_PROMPT = `You are matching pull requests to the software project they most likely belong to.

Each PR below has no explicit project link. For each one, decide whether it clearly belongs to one of the listed projects based on its title and description. Only assign a project when you are confident; otherwise use null.

Projects:
{projects}

PRs:
{prs}

Respond ONLY with this exact JSON (no markdown, no code fences):
{"assignments": [{"prNumber": 123, "projectId": "..."|null, "confidence": 0.0-1.0}]}`;

function truncate(text: string, maxLen: number): string | undefined {
  if (!text || !text.trim()) return undefined;
  const cleaned = text.trim();
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen) + "...";
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return text;
}

function applyPrompts(base: string, promptConfig?: PromptConfig): string {
  return promptConfig?.additionalInstructions
    ? base + "\n\nAdditional instructions: " + promptConfig.additionalInstructions
    : base;
}

function prsToReportPRs(prs: GitHubPR[]): ReportPR[] {
  return prs.map((pr) => ({ title: pr.title, url: pr.url, number: pr.number }));
}

export async function summarizeProject(
  bundle: ProjectBundle,
  startDate: string,
  endDate: string,
  provider: AIProvider,
  promptConfig?: PromptConfig,
): Promise<ReportProject> {
  const { project } = bundle;
  const projectData = JSON.stringify(
    {
      projectName: project.name,
      projectDescription: project.description || undefined,
      progress: project.progress,
      health: project.latestUpdate?.health || undefined,
      targetDate: project.targetDate || undefined,
      latestProjectUpdate: truncate(project.latestUpdate?.body ?? "", 800),
      platform: project.platform,
      prs: bundle.prs.map((p) => ({ title: p.title, description: truncate(p.body, 500) })),
    },
    null,
    2,
  );

  const base = (promptConfig?.projectSummary ?? PROJECT_SUMMARY_PROMPT)
    .replace("{projectName}", project.name)
    .replace("{startDate}", startDate)
    .replace("{endDate}", endDate)
    .replace("{projectData}", projectData);

  const text = await provider.chat([{ role: "user", content: applyPrompts(base, promptConfig) }]);

  let summary: string;
  try {
    summary = (JSON.parse(extractJson(text)) as { summary: string }).summary;
  } catch {
    console.error(`[summarizer] Failed to parse summary for "${project.name}": ${text}`);
    summary = `Work on ${project.name} (${bundle.prs.length} PRs merged).`;
  }

  return {
    projectName: project.name,
    projectUrl: project.url,
    platform: project.platform,
    status: project.status,
    summary,
    prs: prsToReportPRs(bundle.prs),
  };
}

export interface OrphanPairing {
  assigned: Array<{ pr: GitHubPR; projectId: string }>;
  other: GitHubPR[];
}

const ORPHAN_CHUNK = 25;

export async function pairOrphans(
  orphanPRs: GitHubPR[],
  candidateProjects: LinearProject[],
  provider: AIProvider,
  promptConfig?: PromptConfig,
  confidenceThreshold: number = 0.6,
): Promise<OrphanPairing> {
  if (orphanPRs.length === 0 || candidateProjects.length === 0) {
    return { assigned: [], other: orphanPRs };
  }

  const projectsJson = JSON.stringify(
    candidateProjects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      platform: p.platform,
      description: truncate(p.description ?? "", 200),
    })),
    null,
    2,
  );
  const validIds = new Set(candidateProjects.map((p) => p.id));
  const assignedByNumber = new Map<number, string>();

  for (let i = 0; i < orphanPRs.length; i += ORPHAN_CHUNK) {
    const batch = orphanPRs.slice(i, i + ORPHAN_CHUNK);
    const prsJson = JSON.stringify(
      batch.map((p) => ({ prNumber: p.number, title: p.title, description: truncate(p.body, 300) })),
      null,
      2,
    );
    const base = (promptConfig?.orphanPairing ?? ORPHAN_PAIRING_PROMPT)
      .replace("{projects}", projectsJson)
      .replace("{prs}", prsJson);

    const text = await provider.chat(
      [{ role: "user", content: applyPrompts(base, promptConfig) }],
      { maxTokens: 2048 },
    );

    let assignments: Array<{ prNumber: number; projectId: string | null; confidence: number }>;
    try {
      assignments = (JSON.parse(extractJson(text)) as { assignments: typeof assignments }).assignments;
    } catch {
      console.error(`[summarizer] Failed to parse orphan pairings for batch at ${i}: ${text}`);
      continue;
    }

    for (const a of assignments) {
      if (a.projectId && validIds.has(a.projectId) && a.confidence >= confidenceThreshold) {
        assignedByNumber.set(a.prNumber, a.projectId);
      }
    }
  }

  const assigned: OrphanPairing["assigned"] = [];
  const other: GitHubPR[] = [];
  for (const pr of orphanPRs) {
    const projectId = assignedByNumber.get(pr.number);
    if (projectId) assigned.push({ pr, projectId });
    else other.push(pr);
  }
  return { assigned, other };
}

export async function selectTopItems(
  projects: ReportProject[],
  otherPRs: GitHubPR[],
  startDate: string,
  endDate: string,
  provider: AIProvider,
  promptConfig?: PromptConfig,
): Promise<TopItem[]> {
  const summariesJson = JSON.stringify(
    projects.map((p) => ({
      project: p.projectName,
      platform: p.platform,
      summary: p.summary,
      status: p.status,
      items: p.prs.map((i) => i.title),
    })),
    null,
    2,
  );
  const uncategorizedJson = JSON.stringify(
    otherPRs.slice(0, 50).map((p) => ({ title: p.title, url: p.url })),
    null,
    2,
  );

  const base = (promptConfig?.topItems ?? TOP_ITEMS_PROMPT)
    .replace("{startDate}", startDate)
    .replace("{endDate}", endDate)
    .replace("{projectSummaries}", summariesJson)
    .replace("{uncategorizedPRs}", uncategorizedJson);

  const text = await provider.chat([{ role: "user", content: applyPrompts(base, promptConfig) }]);

  try {
    return (JSON.parse(extractJson(text)) as { topItems: TopItem[] }).topItems;
  } catch {
    console.error(`[summarizer] Failed to parse top items: ${text}`);
    return projects.slice(0, 3).map((p) => ({ headline: p.summary, platform: p.platform }));
  }
}
