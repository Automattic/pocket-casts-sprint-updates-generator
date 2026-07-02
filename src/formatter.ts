import type { SprintReport, ReportInitiative, ReportProject } from "./types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function link(label: string, url: string | null, html: boolean): string {
  if (!url) return html ? escapeHtml(label) : label;
  return html
    ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    : `[${label}](${url})`;
}

export function formatHtml(report: SprintReport): string {
  const lines: string[] = [];

  if (report.topItems.length > 0) {
    lines.push("<h2>Top Items Shipped</h2>");
    lines.push("<ul>");
    for (const item of report.topItems) {
      lines.push(`<li>${escapeHtml(item.headline)}</li>`);
    }
    lines.push("</ul>", "");
  }

  for (const initiative of report.initiatives) {
    lines.push(formatInitiativeHtml(initiative));
  }

  const platforms = Object.keys(report.otherByPlatform).sort();
  if (platforms.length > 0) {
    lines.push("<h2>Other</h2>");
    for (const platform of platforms) {
      const items = report.otherByPlatform[platform];
      if (items.length === 0) continue;
      lines.push(`<h3>${escapeHtml(platform)}</h3>`, "<ul>");
      for (const item of items) {
        lines.push(`<li>${link(item.title, item.url, true)}</li>`);
      }
      lines.push("</ul>", "");
    }
  }

  return lines.join("\n");
}

function formatInitiativeHtml(initiative: ReportInitiative): string {
  const lines: string[] = [];

  if (initiative.initiativeName) {
    lines.push(`<h2>${link(initiative.initiativeName, initiative.initiativeUrl, true)}</h2>`);
    for (const project of initiative.projects) {
      lines.push(`<p><strong>${link(project.platform, project.projectUrl, true)}</strong>: <em>${escapeHtml(project.status)}</em></p>`);
      lines.push(`<p>${escapeHtml(project.summary)}</p>`);
      lines.push(prListHtml(project));
    }
  } else {
    const project = initiative.projects[0];
    lines.push(`<h2>${link(project.projectName, project.projectUrl, true)} - <em>${escapeHtml(project.status)}</em></h2>`);
    lines.push(`<p>${escapeHtml(project.summary)}</p>`);
    lines.push(prListHtml(project));
  }

  lines.push("");
  return lines.join("\n");
}

function prListHtml(project: ReportProject): string {
  if (project.prs.length === 0) return "";
  const lines = ["<ul>"];
  for (const pr of project.prs) {
    lines.push(`<li>${link(pr.title, pr.url, true)}</li>`);
  }
  lines.push("</ul>");
  return lines.join("\n");
}

export function formatMarkdown(report: SprintReport): string {
  const lines: string[] = [];

  if (report.topItems.length > 0) {
    lines.push("## Top Items Shipped", "");
    for (const item of report.topItems) {
      lines.push(`- ${item.headline}`);
    }
    lines.push("");
  }

  for (const initiative of report.initiatives) {
    lines.push(formatInitiativeMarkdown(initiative));
  }

  const platforms = Object.keys(report.otherByPlatform).sort();
  if (platforms.length > 0) {
    lines.push("## Other", "");
    for (const platform of platforms) {
      const items = report.otherByPlatform[platform];
      if (items.length === 0) continue;
      lines.push(`### ${platform}`);
      for (const item of items) {
        lines.push(`- ${link(item.title, item.url, false)}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatInitiativeMarkdown(initiative: ReportInitiative): string {
  const lines: string[] = [];

  if (initiative.initiativeName) {
    lines.push(`## ${link(initiative.initiativeName, initiative.initiativeUrl, false)}`, "");
    for (const project of initiative.projects) {
      lines.push(`**${link(project.platform, project.projectUrl, false)}**: *${project.status}*`);
      lines.push(project.summary);
      lines.push(...prListMarkdown(project), "");
    }
  } else {
    const project = initiative.projects[0];
    lines.push(`## ${link(project.projectName, project.projectUrl, false)} - *${project.status}*`, "");
    lines.push(project.summary);
    lines.push(...prListMarkdown(project), "");
  }

  return lines.join("\n");
}

function prListMarkdown(project: ReportProject): string[] {
  return project.prs.map((pr) => `- ${link(pr.title, pr.url, false)}`);
}

export function formatRawGrouped(report: SprintReport): string {
  const lines: string[] = [];
  lines.push(`Sprint Report: ${report.startDate} to ${report.endDate}`, "=".repeat(50), "");

  for (const initiative of report.initiatives) {
    const heading = initiative.initiativeName ?? initiative.projects[0]?.projectName ?? "";
    lines.push(`\n${heading}`);
    for (const project of initiative.projects) {
      lines.push(`  ${project.platform} (${project.status})`);
      for (const pr of project.prs) {
        lines.push(`    - ${pr.title} ${pr.url}`);
      }
    }
  }

  const platforms = Object.keys(report.otherByPlatform).sort();
  if (platforms.length > 0) {
    lines.push("", "OTHER", "-".repeat(30));
    for (const platform of platforms) {
      const items = report.otherByPlatform[platform];
      if (items.length === 0) continue;
      lines.push(`\n${platform}:`);
      for (const item of items) {
        lines.push(`  - ${item.title} ${item.url}`);
      }
    }
  }

  return lines.join("\n");
}
