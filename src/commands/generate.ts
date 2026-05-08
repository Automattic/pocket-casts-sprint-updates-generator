import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadConfig,
  loadEnv,
  getDefaultDateRange,
  resolveAuthors,
  resolveRepos,
  formatDate,
  saveHistoryEntry,
} from "../config.js";
import { fetchMergedPRs } from "../github-client.js";
import { fetchCompletedIssues, fetchActiveProjects } from "../linear-client.js";
import { correlate } from "../correlator.js";
import {
  summarizeProject,
  selectTopItems,
  buildReportItemsFromPRs,
} from "../summarizer.js";
import { formatHtml, formatMarkdown, formatRawGrouped } from "../formatter.js";
import { createProvider } from "../ai/provider.js";
import type { SprintReport, ProjectSummary, ReportItem } from "../types.js";

export interface GenerateOptions {
  sprintStart?: string;
  sprintLength?: string;
  author?: string;
  repos?: string;
  config?: string;
  output: string;
  format: string;
  ai: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export async function generateAction(options: GenerateOptions): Promise<void> {
  loadEnv();
  const config = loadConfig(options.config);

  // Resolve sprint window: --sprint-start/--sprint-length override config cadence
  let startDate: string;
  let endDate: string;

  if (options.sprintStart) {
    const weeks = parseInt(options.sprintLength ?? String(config.sprint?.durationWeeks ?? 2), 10);
    const start = new Date(options.sprintStart + "T00:00:00");
    const end = new Date(start.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    startDate = formatDate(start);
    endDate = formatDate(end);
  } else {
    const defaults = getDefaultDateRange(config.sprint);
    startDate = defaults.startDate;
    endDate = defaults.endDate;
  }

  const authors = resolveAuthors(config, options.author);
  const repos = resolveRepos(config, options.repos);

  console.error(`Sprint Report: ${startDate} to ${endDate}`);
  console.error(`Authors: ${authors.githubAuthors.join(", ")}`);
  console.error(`Repos: ${repos.map((r) => r.name).join(", ")}`);
  console.error("");

  // Fetch data in parallel
  console.error("Fetching data...");
  const [prs, issues, projectMetas] = await Promise.all([
    fetchMergedPRs(config, repos, authors.githubAuthors, startDate, endDate, options.verbose),
    fetchCompletedIssues(config, authors.linearEmails, startDate, endDate, options.verbose),
    fetchActiveProjects(config, authors.linearEmails, startDate, endDate, options.verbose),
  ]);

  console.error(`  GitHub PRs: ${prs.length}`);
  console.error(`  Linear issues: ${issues.length}`);
  console.error(`  Active projects: ${projectMetas.length}`);
  console.error("");

  if (options.dryRun) {
    console.error("Dry run complete. Data fetched successfully.");
    console.error("\nGitHub PRs:");
    for (const pr of prs) {
      console.error(`  #${pr.number} ${pr.title}`);
    }
    console.error("\nLinear Issues:");
    for (const issue of issues) {
      const project = issue.projectName ? ` [${issue.projectName}]` : "";
      console.error(`  ${issue.identifier} ${issue.title}${project}`);
    }
    return;
  }

  // Correlate
  console.error("Correlating data...");
  const { projectGroups, unmatchedPRs } = correlate(issues, prs, projectMetas, config);
  console.error(`  Project groups: ${projectGroups.length}`);
  console.error(`  Unmatched PRs: ${unmatchedPRs.length}`);
  console.error("");

  // Build report
  let report: SprintReport;

  if (options.ai) {
    const provider = await createProvider(config.ai.provider, config.ai.model);
    console.error(`Generating AI summaries (${provider.name})...`);

    const projectSummaries: ProjectSummary[] = [];
    for (const group of projectGroups) {
      console.error(`  Summarizing: ${group.projectName}...`);
      const summary = await summarizeProject(group, startDate, endDate, provider, config.prompts);
      projectSummaries.push(summary);
    }

    const uncategorizedItems: ReportItem[] = buildReportItemsFromPRs(
      unmatchedPRs.map((pr) => ({ title: pr.title, url: pr.url })),
    );

    console.error("  Selecting top items...");
    const topItems = await selectTopItems(
      projectSummaries,
      uncategorizedItems,
      startDate,
      endDate,
      provider,
      config.prompts,
    );

    const otherByPlatform: Record<string, ReportItem[]> = {};
    for (const pr of unmatchedPRs) {
      const platform = config.repoPlatformMap[pr.repository] ?? "Other";
      if (!otherByPlatform[platform]) otherByPlatform[platform] = [];
      otherByPlatform[platform].push({ title: pr.title, url: pr.url, linearId: null });
    }

    report = { startDate, endDate, topItems, projectUpdates: projectSummaries, otherByPlatform };
  } else {
    const projectSummaries: ProjectSummary[] = projectGroups.map((group) => {
      const items: ReportItem[] = [
        ...group.prs.map((pr) => ({
          title: pr.title,
          url: pr.url,
          linearId:
            group.issues.find((i) => i.prUrls.some((u) => u.includes(String(pr.number))))?.identifier ?? null,
        })),
        ...group.issues
          .filter((i) => !group.prs.some((pr) => i.prUrls.some((u) => u.includes(String(pr.number)))))
          .map((i) => ({ title: i.title, url: null as string | null, linearId: i.identifier })),
      ];

      return {
        projectName: group.projectName,
        projectUrl: group.projectUrl,
        platform: group.platform,
        summary: `${group.issues.length} issues completed, ${group.prs.length} PRs merged`,
        status: "In Progress" as const,
        items,
      };
    });

    const otherByPlatform: Record<string, ReportItem[]> = {};
    for (const pr of unmatchedPRs) {
      const platform = config.repoPlatformMap[pr.repository] ?? "Other";
      if (!otherByPlatform[platform]) otherByPlatform[platform] = [];
      otherByPlatform[platform].push({ title: pr.title, url: pr.url, linearId: null });
    }

    report = { startDate, endDate, topItems: [], projectUpdates: projectSummaries, otherByPlatform };
  }

  // Output
  if (options.format === "html" || options.format === "both") {
    const html = formatHtml(report);
    const outputPath = resolve(options.output);
    writeFileSync(outputPath, html, "utf-8");
    console.error(`\nHTML written to: ${outputPath}`);
  }

  if (options.format === "markdown" || options.format === "both") {
    console.log(formatMarkdown(report));
  }

  if (!options.ai) {
    console.log(formatRawGrouped(report));
  }

  // Record in history (skip dry runs)
  if (!options.dryRun) {
    const totalPRs = report.projectUpdates.reduce((n, p) => n + p.items.filter((i) => i.url).length, 0)
      + Object.values(report.otherByPlatform).reduce((n, items) => n + items.length, 0);
    const totalIssues = report.projectUpdates.reduce((n, p) => n + p.items.filter((i) => i.linearId).length, 0);

    saveHistoryEntry({
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      author: authors.githubAuthors.join(", "),
      projectCount: report.projectUpdates.length,
      prCount: totalPRs,
      issueCount: totalIssues,
    });
  }

  console.error("\nDone!");
}
