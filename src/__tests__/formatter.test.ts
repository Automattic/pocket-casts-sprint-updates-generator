import { describe, it, expect } from "vitest";
import { formatHtml, formatMarkdown } from "../formatter.js";
import type { SprintReport } from "../types.js";

function makeReport(overrides: Partial<SprintReport> = {}): SprintReport {
  return {
    startDate: "2026-04-08",
    endDate: "2026-04-22",
    topItems: [{ headline: "Shipped HLS streaming", platform: "Android" }],
    initiatives: [
      {
        initiativeName: "HLS Support",
        initiativeUrl: "https://linear.app/a8c/initiative/hls-support-abc",
        projects: [
          {
            projectName: "HLS Android",
            projectUrl: "https://linear.app/a8c/project/hls-android-111",
            platform: "Android",
            status: "In Progress",
            summary: "Integrated HLS playback via ExoPlayer.",
            prs: [
              {
                title: "[HLS] Stream HLS rendition",
                url: "https://github.com/Automattic/pocket-casts-android/pull/5230",
                number: 5230,
              },
            ],
          },
        ],
      },
      {
        initiativeName: null,
        initiativeUrl: null,
        projects: [
          {
            projectName: "Up Next Duration Sort",
            projectUrl: "https://linear.app/a8c/project/up-next-222",
            platform: "Cross-platform",
            status: "Complete",
            summary: "Up Next sort by duration is complete.",
            prs: [
              {
                title: "Add Up Next queue sorting",
                url: "https://github.com/Automattic/pocket-casts-android/pull/5100",
                number: 5100,
              },
            ],
          },
        ],
      },
    ],
    otherByPlatform: {
      Android: [
        { title: "Bump analytics lib", url: "https://github.com/Automattic/pocket-casts-android/pull/5001" },
      ],
    },
    ...overrides,
  };
}

describe("formatHtml", () => {
  it("links the initiative heading to its overview URL", () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('<a href="https://linear.app/a8c/initiative/hls-support-abc">HLS Support</a>');
  });

  it("links the platform label to the project overview URL with status", () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('<strong><a href="https://linear.app/a8c/project/hls-android-111">Android</a></strong>: <em>In Progress</em>');
  });

  it("renders a standalone project as its own heading with inline status", () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('<a href="https://linear.app/a8c/project/up-next-222">Up Next Duration Sort</a> - <em>Complete</em>');
  });

  it("links PRs and renders the Other section", () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('<a href="https://github.com/Automattic/pocket-casts-android/pull/5230">[HLS] Stream HLS rendition</a>');
    expect(html).toContain("<h2>Other</h2>");
    expect(html).toContain("<h3>Android</h3>");
  });

  it("includes Top Items", () => {
    const html = formatHtml(makeReport());
    expect(html).toContain("<h2>Top Items Shipped</h2>");
    expect(html).toContain("<li>Shipped HLS streaming</li>");
  });
});

describe("formatMarkdown", () => {
  it("renders initiative, platform link, status, and PRs", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("## [HLS Support](https://linear.app/a8c/initiative/hls-support-abc)");
    expect(md).toContain("**[Android](https://linear.app/a8c/project/hls-android-111)**: *In Progress*");
    expect(md).toContain("- [[HLS] Stream HLS rendition](https://github.com/Automattic/pocket-casts-android/pull/5230)");
  });

  it("renders standalone project heading with status", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("## [Up Next Duration Sort](https://linear.app/a8c/project/up-next-222) - *Complete*");
  });
});
