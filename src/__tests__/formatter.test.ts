import { describe, it, expect } from "vitest";
import { formatHtml, formatMarkdown } from "../formatter.js";
import type { SprintReport } from "../types.js";

function makeReport(overrides: Partial<SprintReport> = {}): SprintReport {
  return {
    startDate: "2026-04-08",
    endDate: "2026-04-22",
    topItems: [
      { headline: "Fixed Wear OS Up Next queue", platform: "Android" },
      { headline: "Added Media3 session integration", platform: "Android" },
    ],
    projectUpdates: [
      {
        projectName: "Playback robustness",
        projectUrl: "https://linear.app/a8c/project/playback-robustness-abc123",
        platform: "Android",
        summary:
          "Wired Media3 session into automotive and wear platforms.",
        status: "In Progress",
        items: [
          {
            title: "Fix Wear Up Next by emitting timeline events",
            url: "https://github.com/Automattic/pocket-casts-android/pull/5230",
            linearId: "PCDROID-540",
          },
          {
            title: "Wire automotive for Media3 service toggle",
            url: "https://github.com/Automattic/pocket-casts-android/pull/5228",
            linearId: "PCDROID-538",
          },
        ],
      },
    ],
    otherByPlatform: {
      Android: [
        {
          title: "Fix Glance widgets crash",
          url: "https://github.com/Automattic/pocket-casts-android/pull/5200",
          linearId: null,
        },
      ],
    },
    ...overrides,
  };
}

describe("formatHtml", () => {
  it("includes top items section", () => {
    const html = formatHtml(makeReport());

    expect(html).toContain("<h2>Top Items Shipped</h2>");
    expect(html).toContain("Fixed Wear OS Up Next queue");
    expect(html).toContain("Added Media3 session integration");
  });

  it("includes project updates with status", () => {
    const html = formatHtml(makeReport());

    expect(html).toContain("<h2>Project Updates</h2>");
    expect(html).toContain(
      '<a href="https://linear.app/a8c/project/playback-robustness-abc123">Playback robustness</a> - <em>In Progress</em>',
    );
    expect(html).toContain(
      "Wired Media3 session into automotive and wear platforms.",
    );
  });

  it("renders PR links with Linear IDs", () => {
    const html = formatHtml(makeReport());

    expect(html).toContain(
      '<a href="https://github.com/Automattic/pocket-casts-android/pull/5230">Fix Wear Up Next by emitting timeline events</a> (PCDROID-540)',
    );
  });

  it("includes Other section", () => {
    const html = formatHtml(makeReport());

    expect(html).toContain("<h2>Other</h2>");
    expect(html).toContain("<h3>Android</h3>");
    expect(html).toContain("Fix Glance widgets crash");
  });

  it("omits empty top items section", () => {
    const html = formatHtml(makeReport({ topItems: [] }));

    expect(html).not.toContain("Top Items Shipped");
  });

  it("omits empty Other section", () => {
    const html = formatHtml(makeReport({ otherByPlatform: {} }));

    expect(html).not.toContain("<h2>Other</h2>");
  });

  it("escapes HTML in titles", () => {
    const html = formatHtml(
      makeReport({
        topItems: [
          { headline: "Fix <script>alert(1)</script>", platform: "Android" },
        ],
      }),
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("formatMarkdown", () => {
  it("includes top items section", () => {
    const md = formatMarkdown(makeReport());

    expect(md).toContain("## Top Items Shipped");
    expect(md).toContain("- Fixed Wear OS Up Next queue");
  });

  it("includes project updates with status", () => {
    const md = formatMarkdown(makeReport());

    expect(md).toContain(
      "### [Playback robustness](https://linear.app/a8c/project/playback-robustness-abc123) - *In Progress*",
    );
  });

  it("renders PR links in markdown format", () => {
    const md = formatMarkdown(makeReport());

    expect(md).toContain(
      "- [Fix Wear Up Next by emitting timeline events](https://github.com/Automattic/pocket-casts-android/pull/5230) (PCDROID-540)",
    );
  });

  it("includes Other section", () => {
    const md = formatMarkdown(makeReport());

    expect(md).toContain("## Other");
    expect(md).toContain("### Android");
    expect(md).toContain("Fix Glance widgets crash");
  });

  it("omits empty sections", () => {
    const md = formatMarkdown(
      makeReport({ topItems: [], projectUpdates: [], otherByPlatform: {} }),
    );

    expect(md).not.toContain("Top Items");
    expect(md).not.toContain("Project Updates");
    expect(md).not.toContain("Other");
  });
});
