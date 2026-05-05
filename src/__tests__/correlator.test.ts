import { describe, it, expect } from "vitest";
import { extractLinearRefs, correlate } from "../correlator.js";
import type { LinearIssue, GitHubPR, SprintConfig } from "../types.js";
import type { ProjectMeta } from "../linear-client.js";

const defaultConfig: SprintConfig = {
  githubOrg: "Automattic",
  repos: [{ name: "pocket-casts-android", platform: "Android" }],
  linearTeamKeys: ["PCDROID"],
  members: {
    testuser: { linearEmail: "test@example.com", name: "Test User" },
  },
  defaultAuthor: "testuser",
  ai: { provider: "groq", model: "llama-3.3-70b-versatile" },
  sprint: { anchorDate: "2026-04-26", durationWeeks: 2 },
  repoPlatformMap: { "pocket-casts-android": "Android" },
};

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    identifier: "PCDROID-100",
    title: "Test issue",
    description: "",
    status: "Done",
    statusType: "completed",
    projectName: "Test Project",
    projectId: "proj-1",
    projectUrl: "https://linear.app/a8c/project/test-project-abc123",
    projectProgress: 0.5,
    projectState: "started",
    assigneeName: "Tester",
    completedAt: "2026-04-15T10:00:00Z",
    prUrls: [],
    labels: [],
    ...overrides,
  };
}

function makePR(overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: 5001,
    title: "Fix something",
    url: "https://github.com/Automattic/pocket-casts-android/pull/5001",
    body: "",
    closedAt: "2026-04-15T12:00:00Z",
    author: "testuser",
    repository: "pocket-casts-android",
    labels: [],
    ...overrides,
  };
}

describe("extractLinearRefs", () => {
  it("extracts simple identifier", () => {
    expect(extractLinearRefs("Fixes PCDROID-539")).toEqual(["PCDROID-539"]);
  });

  it("extracts multiple identifiers", () => {
    const refs = extractLinearRefs("PCDROID-100 and PCDROID-200");
    expect(refs).toContain("PCDROID-100");
    expect(refs).toContain("PCDROID-200");
    expect(refs).toHaveLength(2);
  });

  it("extracts from linear.app URL", () => {
    const refs = extractLinearRefs(
      "See https://linear.app/a8c/issue/PCDROID-539/fix-something",
    );
    expect(refs).toContain("PCDROID-539");
  });

  it("deduplicates refs", () => {
    const refs = extractLinearRefs("PCDROID-100 PCDROID-100 PCDROID-100");
    expect(refs).toEqual(["PCDROID-100"]);
  });

  it("returns empty for no refs", () => {
    expect(extractLinearRefs("Just a regular PR description")).toEqual([]);
  });

  it("handles various prefixes", () => {
    const refs = extractLinearRefs("PCIOS-50 PCWEB-200 PCDROID-300");
    expect(refs).toContain("PCIOS-50");
    expect(refs).toContain("PCWEB-200");
    expect(refs).toContain("PCDROID-300");
  });
});

describe("correlate", () => {
  it("matches PR to issue via attachment URL", () => {
    const pr = makePR({
      url: "https://github.com/Automattic/pocket-casts-android/pull/5001",
    });
    const issue = makeIssue({
      prUrls: [
        "https://github.com/Automattic/pocket-casts-android/pull/5001",
      ],
    });

    const result = correlate([issue], [pr], [], defaultConfig);

    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0].projectName).toBe("Test Project");
    expect(result.projectGroups[0].prs).toHaveLength(1);
    expect(result.unmatchedPRs).toHaveLength(0);
  });

  it("matches PR to issue via body reference", () => {
    const pr = makePR({
      body: "Fixes PCDROID-100",
    });
    const issue = makeIssue({ identifier: "PCDROID-100" });

    const result = correlate([issue], [pr], [], defaultConfig);

    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0].prs).toHaveLength(1);
    expect(result.unmatchedPRs).toHaveLength(0);
  });

  it("puts unmatched PRs in unmatchedPRs", () => {
    const pr = makePR({ body: "No linear reference here" });
    const issue = makeIssue();

    const result = correlate([issue], [pr], [], defaultConfig);

    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0].prs).toHaveLength(0);
    expect(result.unmatchedPRs).toHaveLength(1);
    expect(result.unmatchedPRs[0].number).toBe(5001);
  });

  it("groups issues by project", () => {
    const issue1 = makeIssue({
      identifier: "PCDROID-100",
      projectName: "Project A",
    });
    const issue2 = makeIssue({
      identifier: "PCDROID-200",
      projectName: "Project B",
    });
    const issue3 = makeIssue({
      identifier: "PCDROID-300",
      projectName: "Project A",
    });

    const result = correlate([issue1, issue2, issue3], [], [], defaultConfig);

    expect(result.projectGroups).toHaveLength(2);
    const projectA = result.projectGroups.find(
      (g) => g.projectName === "Project A",
    );
    const projectB = result.projectGroups.find(
      (g) => g.projectName === "Project B",
    );
    expect(projectA?.issues).toHaveLength(2);
    expect(projectB?.issues).toHaveLength(1);
  });

  it("handles issue with no project", () => {
    const issue = makeIssue({ projectName: null, projectId: null });
    const pr = makePR({
      body: "Fixes PCDROID-100",
    });

    const result = correlate([issue], [pr], [], defaultConfig);

    // No project group created (null project goes to "other")
    expect(result.projectGroups).toHaveLength(0);
    // PR matched to a null-project issue ends up in unmatched
    expect(result.unmatchedPRs).toHaveLength(1);
  });

  it("deduplicates PRs matched via both attachment and body ref", () => {
    const pr = makePR({
      url: "https://github.com/Automattic/pocket-casts-android/pull/5001",
      body: "Fixes PCDROID-100",
    });
    const issue = makeIssue({
      identifier: "PCDROID-100",
      prUrls: [
        "https://github.com/Automattic/pocket-casts-android/pull/5001",
      ],
    });

    const result = correlate([issue], [pr], [], defaultConfig);

    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0].prs).toHaveLength(1);
    expect(result.unmatchedPRs).toHaveLength(0);
  });

  it("uses project meta for progress data", () => {
    const issue = makeIssue({ projectName: "Media3 Migration" });
    const meta: ProjectMeta = {
      name: "Media3 Migration",
      state: "started",
      progress: 0.75,
      description: "Migrate to Media3",
      startDate: "2026-03-01",
      targetDate: "2026-05-01",
    };

    const result = correlate([issue], [], [meta], defaultConfig);

    expect(result.projectGroups).toHaveLength(1);
    // The project group picks up the meta
    expect(result.projectGroups[0].projectName).toBe("Media3 Migration");
  });

  it("handles empty inputs", () => {
    const result = correlate([], [], [], defaultConfig);

    expect(result.projectGroups).toHaveLength(0);
    expect(result.unmatchedPRs).toHaveLength(0);
  });

  it("detects platform from PR repository", () => {
    const issue = makeIssue({ projectName: "My Project" });
    const pr = makePR({
      repository: "pocket-casts-android",
      body: "Fixes PCDROID-100",
    });

    const result = correlate([issue], [pr], [], defaultConfig);

    expect(result.projectGroups[0].platform).toBe("Android");
  });
});
