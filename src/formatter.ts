import type { SprintReport, ProjectSummary, ReportItem } from "./types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatItemHtml(item: ReportItem): string {
  const suffix = item.linearId ? ` (${escapeHtml(item.linearId)})` : "";
  if (item.url) {
    return `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>${suffix}</li>`;
  }
  return `<li>${escapeHtml(item.title)}${suffix}</li>`;
}

function formatItemMarkdown(item: ReportItem): string {
  const suffix = item.linearId ? ` (${item.linearId})` : "";
  if (item.url) {
    return `- [${item.title}](${item.url})${suffix}`;
  }
  return `- ${item.title}${suffix}`;
}

export function formatHtml(report: SprintReport): string {
  const lines: string[] = [];

  // Top Items
  if (report.topItems.length > 0) {
    lines.push("<h2>Top Items Shipped</h2>");
    lines.push("<ul>");
    for (const item of report.topItems) {
      lines.push(`<li>${escapeHtml(item.headline)}</li>`);
    }
    lines.push("</ul>");
    lines.push("");
  }

  // Project Updates
  if (report.projectUpdates.length > 0) {
    lines.push("<h2>Project Updates</h2>");
    for (const project of report.projectUpdates) {
      lines.push(formatProjectHtml(project));
    }
  }

  // Other
  const platforms = Object.keys(report.otherByPlatform).sort();
  if (platforms.length > 0) {
    lines.push("<h2>Other</h2>");
    for (const platform of platforms) {
      const items = report.otherByPlatform[platform];
      if (items.length === 0) continue;
      lines.push(`<h3>${escapeHtml(platform)}</h3>`);
      lines.push("<ul>");
      for (const item of items) {
        lines.push(formatItemHtml(item));
      }
      lines.push("</ul>");
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatProjectHtml(project: ProjectSummary): string {
  const lines: string[] = [];
  const projectLabel = project.projectUrl
    ? `<a href="${escapeHtml(project.projectUrl)}">${escapeHtml(project.projectName)}</a>`
    : escapeHtml(project.projectName);
  lines.push(
    `<h3>${escapeHtml(project.platform)}: ${projectLabel} - <em>${escapeHtml(project.status)}</em></h3>`,
  );
  lines.push(`<p>${escapeHtml(project.summary)}</p>`);

  if (project.items.length > 0) {
    lines.push("<ul>");
    for (const item of project.items) {
      lines.push(formatItemHtml(item));
    }
    lines.push("</ul>");
  }
  lines.push("");

  return lines.join("\n");
}

export function formatMarkdown(report: SprintReport): string {
  const lines: string[] = [];

  // Top Items
  if (report.topItems.length > 0) {
    lines.push("## Top Items Shipped");
    lines.push("");
    for (const item of report.topItems) {
      lines.push(`- ${item.headline}`);
    }
    lines.push("");
  }

  // Project Updates
  if (report.projectUpdates.length > 0) {
    lines.push("## Project Updates");
    lines.push("");
    for (const project of report.projectUpdates) {
      lines.push(formatProjectMarkdown(project));
    }
  }

  // Other
  const platforms = Object.keys(report.otherByPlatform).sort();
  if (platforms.length > 0) {
    lines.push("## Other");
    lines.push("");
    for (const platform of platforms) {
      const items = report.otherByPlatform[platform];
      if (items.length === 0) continue;
      lines.push(`### ${platform}`);
      for (const item of items) {
        lines.push(formatItemMarkdown(item));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatProjectMarkdown(project: ProjectSummary): string {
  const lines: string[] = [];
  const projectLabel = project.projectUrl
    ? `[${project.projectName}](${project.projectUrl})`
    : project.projectName;
  lines.push(`### ${project.platform}: ${projectLabel} - *${project.status}*`);
  lines.push(project.summary);
  for (const item of project.items) {
    lines.push(formatItemMarkdown(item));
  }
  lines.push("");
  return lines.join("\n");
}

export function formatRawGrouped(
  report: SprintReport,
): string {
  const lines: string[] = [];

  lines.push(`Sprint Report: ${report.startDate} to ${report.endDate}`);
  lines.push("=".repeat(50));
  lines.push("");

  if (report.projectUpdates.length > 0) {
    lines.push("PROJECT UPDATES");
    lines.push("-".repeat(30));
    for (const project of report.projectUpdates) {
      lines.push(
        `\n[${project.platform}] ${project.projectName} (${project.status})`,
      );
      for (const item of project.items) {
        const id = item.linearId ? ` ${item.linearId}` : "";
        const url = item.url ? ` ${item.url}` : "";
        lines.push(`  - ${item.title}${id}${url}`);
      }
    }
    lines.push("");
  }

  const platforms = Object.keys(report.otherByPlatform).sort();
  if (platforms.length > 0) {
    lines.push("OTHER");
    lines.push("-".repeat(30));
    for (const platform of platforms) {
      const items = report.otherByPlatform[platform];
      if (items.length === 0) continue;
      lines.push(`\n${platform}:`);
      for (const item of items) {
        const url = item.url ? ` ${item.url}` : "";
        lines.push(`  - ${item.title}${url}`);
      }
    }
  }

  return lines.join("\n");
}
