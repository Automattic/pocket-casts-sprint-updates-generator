import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  loadConfig,
  loadEnv,
  getDefaultDateRange,
  resolveAuthors,
  filterRepos,
  formatDate,
  saveHistoryEntry,
} from "../config.js";
import { discoverRepos, fetchMergedPRs } from "../github-client.js";
import { resolve, groupBundlesByInitiative, addPRToBundle } from "../correlator.js";
import { summarizeProject, pairOrphans, selectTopItems } from "../summarizer.js";
import { formatHtml, formatMarkdown, formatRawGrouped } from "../formatter.js";
import { createProvider } from "../ai/provider.js";
import { ensureCredentials } from "./setup.js";
import type {
  SprintReport,
  ReportInitiative,
  ReportProject,
  GitHubPR,
  LinearProject,
  OtherItem,
} from "../types.js";

export interface GenerateOptions {
  sprintStart?: string;
  sprintLength?: string;
  author?: string;
  repos?: string;
  config?: string;
  output: string;
  format: string;
  ai: boolean;
  orphanPairing: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export async function generateAction(options: GenerateOptions): Promise<void> {
  loadEnv();
  const config = loadConfig(options.config);
  if (!options.dryRun) {
    await ensureCredentials(config, options.ai);
  }

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

  console.error(`Sprint Report: ${startDate} to ${endDate}`);
  console.error(`Authors: ${authors.githubAuthors.join(", ")}`);
  console.error("");

  console.error("Discovering repositories...");
  const discovered = await discoverRepos(config, options.verbose);
  const repos = filterRepos(discovered, options.repos);
  console.error(`  Repos: ${repos.length} (${config.repoPrefix}*)`);

  console.error("Fetching merged PRs...");
  const prs = await fetchMergedPRs(config, repos, authors.githubAuthors, startDate, endDate, options.verbose);
  console.error(`  GitHub PRs: ${prs.length}`);
  console.error("");

  if (options.dryRun) {
    console.error("Dry run complete. Data fetched successfully.");
    for (const pr of prs) {
      const refs = pr.linearRefs.length ? ` -> ${pr.linearRefs.join(", ")}` : "";
      console.error(`  #${pr.number} [${pr.repository}] ${pr.title}${refs}`);
    }
    return;
  }

  console.error("Resolving Linear projects and initiatives...");
  const { bundles, orphanPRs } = await resolve(prs, config, options.verbose);
  console.error(`  Projects: ${bundles.length}`);
  console.error(`  Orphan PRs: ${orphanPRs.length}`);
  console.error("");

  let report: SprintReport;

  if (options.ai) {
    const provider = await createProvider(config.ai.provider, config.ai.model);
    console.error(`Generating AI summaries (${provider.name})...`);

    let other = orphanPRs;
    if (options.orphanPairing) {
      const candidateProjects: LinearProject[] = bundles.map((b) => b.project);
      console.error("  Pairing orphan PRs...");
      const paired = await pairOrphans(orphanPRs, candidateProjects, provider, config.prompts);
      other = paired.other;
      for (const { pr, projectId } of paired.assigned) {
        addPRToBundle(bundles, projectId, pr);
      }
    }

    const groups = groupBundlesByInitiative(bundles);
    const initiatives: ReportInitiative[] = [];
    const allProjects: ReportProject[] = [];
    for (const group of groups) {
      const projects: ReportProject[] = [];
      for (const bundle of group.bundles) {
        console.error(`  Summarizing: ${bundle.project.name}...`);
        const summary = await summarizeProject(bundle, startDate, endDate, provider, config.prompts);
        projects.push(summary);
        allProjects.push(summary);
      }
      initiatives.push({
        initiativeName: group.initiativeName,
        initiativeUrl: group.initiativeUrl,
        projects,
      });
    }

    console.error("  Selecting top items...");
    const topItems = await selectTopItems(allProjects, other, startDate, endDate, provider, config.prompts);

    report = { startDate, endDate, topItems, initiatives, otherByPlatform: bucketByPlatform(other) };
  } else {
    const groups = groupBundlesByInitiative(bundles);
    const initiatives: ReportInitiative[] = groups.map((group) => ({
      initiativeName: group.initiativeName,
      initiativeUrl: group.initiativeUrl,
      projects: group.bundles.map((bundle) => ({
        projectName: bundle.project.name,
        projectUrl: bundle.project.url,
        platform: bundle.project.platform,
        status: bundle.project.status,
        summary: `${bundle.prs.length} PRs merged`,
        prs: bundle.prs.map((pr) => ({ title: pr.title, url: pr.url, number: pr.number })),
      })),
    }));

    report = { startDate, endDate, topItems: [], initiatives, otherByPlatform: bucketByPlatform(orphanPRs) };
  }

  assertNoDroppedPRs(prs, report);

  if (options.format === "html" || options.format === "both") {
    const html = formatHtml(report);
    const outputPath = resolvePath(options.output);
    writeFileSync(outputPath, html, "utf-8");
    console.error(`\nHTML written to: ${outputPath}`);
  }
  if (options.format === "markdown" || options.format === "both") {
    console.log(formatMarkdown(report));
  }
  if (!options.ai) {
    console.log(formatRawGrouped(report));
  }

  const totalPRs = report.initiatives.reduce(
    (n, i) => n + i.projects.reduce((m, p) => m + p.prs.length, 0),
    0,
  ) + Object.values(report.otherByPlatform).reduce((n, items) => n + items.length, 0);

  saveHistoryEntry({
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    author: authors.githubAuthors.join(", "),
    projectCount: report.initiatives.reduce((n, i) => n + i.projects.length, 0),
    prCount: totalPRs,
    issueCount: 0,
  });

  console.error("\nDone!");
}

function bucketByPlatform(prs: GitHubPR[]): Record<string, OtherItem[]> {
  const out: Record<string, OtherItem[]> = {};
  for (const pr of prs) {
    const platform = pr.platform || "Other";
    (out[platform] ??= []).push({ title: pr.title, url: pr.url });
  }
  return out;
}

function assertNoDroppedPRs(prs: GitHubPR[], report: SprintReport): void {
  const rendered = new Set<string>([
    ...report.initiatives.flatMap((i) => i.projects.flatMap((p) => p.prs.map((pr) => pr.url))),
    ...Object.values(report.otherByPlatform).flatMap((items) => items.map((i) => i.url)),
  ]);
  const dropped = prs.filter((pr) => !rendered.has(pr.url));
  if (dropped.length > 0) {
    console.error(`  WARNING: ${dropped.length} fetched PR(s) are missing from the report:`);
    for (const pr of dropped) {
      console.error(`    #${pr.number} ${pr.title} (${pr.url})`);
    }
  }
}
