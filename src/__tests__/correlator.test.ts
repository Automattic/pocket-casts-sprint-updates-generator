import { describe, it, expect } from "vitest";
import { extractLinearRefs, groupBundlesByInitiative, addPRToBundle, splitBundleByPlatform } from "../correlator.js";
import type { GitHubPR, LinearProject, ProjectBundle } from "../types.js";

function makePR(number: number, overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/Automattic/pocket-casts-android/pull/${number}`,
    body: "",
    closedAt: "2026-04-10T00:00:00Z",
    author: "sztomek",
    repository: "pocket-casts-android",
    platform: "Android",
    labels: [],
    linearRefs: [],
    ...overrides,
  };
}

function makeProject(id: string, overrides: Partial<LinearProject> = {}): LinearProject {
  return {
    id,
    name: `Project ${id}`,
    url: `https://linear.app/a8c/project/${id}`,
    teamKeys: ["PCDROID"],
    platform: "Android",
    status: "In Progress",
    progress: 0.5,
    description: null,
    targetDate: null,
    initiative: null,
    latestUpdate: null,
    ...overrides,
  };
}

function makeBundle(project: LinearProject, prs: GitHubPR[]): ProjectBundle {
  return { project, prs, tickets: [] };
}

describe("extractLinearRefs", () => {
  it("extracts bare identifiers", () => {
    expect(extractLinearRefs("Fixes PCDROID-539 and PCIOS-12")).toEqual(
      expect.arrayContaining(["PCDROID-539", "PCIOS-12"]),
    );
  });

  it("extracts identifiers from linear.app URLs", () => {
    const refs = extractLinearRefs("See https://linear.app/a8c/issue/PCWEB-77/some-slug");
    expect(refs).toContain("PCWEB-77");
  });

  it("dedupes", () => {
    expect(extractLinearRefs("PCDROID-1 PCDROID-1")).toEqual(["PCDROID-1"]);
  });

  it("returns nothing for text without refs", () => {
    expect(extractLinearRefs("no references here")).toEqual([]);
  });
});

describe("splitBundleByPlatform", () => {
  const map = { PCDROID: "Android", PCIOS: "iOS", PCWEB: "Web", PCSERVER: "Server" };

  it("keeps a single-platform bundle as one slice", () => {
    const bundle = makeBundle(makeProject("a"), [makePR(1), makePR(2)]);
    const slices = splitBundleByPlatform(bundle, map);
    expect(slices).toHaveLength(1);
    expect(slices[0].project.platform).toBe("Android");
    expect(slices[0].prs).toHaveLength(2);
  });

  it("splits a cross-platform project by the PRs' own platforms", () => {
    const project = makeProject("a", { teamKeys: ["PCDROID", "PCIOS"] });
    const android = makePR(1, { platform: "Android", repository: "pocket-casts-android" });
    const ios = makePR(2, { platform: "iOS", repository: "pocket-casts-ios" });
    const web = makePR(3, { platform: "Web", repository: "pocket-casts-webplayer" });
    const slices = splitBundleByPlatform(makeBundle(project, [android, ios, web]), map);
    const byPlatform = Object.fromEntries(slices.map((s) => [s.project.platform, s.prs]));
    expect(slices).toHaveLength(3);
    expect(byPlatform.Android.map((p) => p.number)).toEqual([1]);
    expect(byPlatform.iOS.map((p) => p.number)).toEqual([2]);
    expect(byPlatform.Web.map((p) => p.number)).toEqual([3]);
  });

  it("attaches shared-repo (Other) PRs to the primary platform instead of splitting", () => {
    const project = makeProject("a", { teamKeys: ["PCDROID"] });
    const android = makePR(1, { platform: "Android" });
    const tooling = makePR(2, { platform: "Other", repository: "pocket-casts-collage-image" });
    const slices = splitBundleByPlatform(makeBundle(project, [android, tooling]), map);
    expect(slices).toHaveLength(1);
    expect(slices[0].project.platform).toBe("Android");
    expect(slices[0].prs).toHaveLength(2);
  });
});

describe("groupBundlesByInitiative", () => {
  it("groups projects that share an initiative", () => {
    const initiative = { id: "init-1", name: "HLS Support", url: "https://linear.app/a8c/initiative/init-1" };
    const android = makeProject("a", { platform: "Android", initiative });
    const ios = makeProject("b", { platform: "iOS", initiative });
    const groups = groupBundlesByInitiative([
      makeBundle(android, [makePR(1)]),
      makeBundle(ios, [makePR(2)]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].initiativeName).toBe("HLS Support");
    expect(groups[0].bundles).toHaveLength(2);
  });

  it("emits a null-initiative group per standalone project", () => {
    const groups = groupBundlesByInitiative([
      makeBundle(makeProject("a"), [makePR(1)]),
      makeBundle(makeProject("b"), [makePR(2)]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.initiativeName === null)).toBe(true);
  });

  it("sorts groups by total PR count descending", () => {
    const initiative = { id: "init-1", name: "Big", url: "u" };
    const big = makeProject("a", { initiative });
    const small = makeProject("b");
    const groups = groupBundlesByInitiative([
      makeBundle(small, [makePR(1)]),
      makeBundle(big, [makePR(2), makePR(3)]),
    ]);
    expect(groups[0].initiativeName).toBe("Big");
  });
});

describe("addPRToBundle", () => {
  it("adds a PR to the matching bundle without duplicating", () => {
    const bundle = makeBundle(makeProject("a"), []);
    const pr = makePR(1);
    addPRToBundle([bundle], "a", pr);
    addPRToBundle([bundle], "a", pr);
    expect(bundle.prs).toHaveLength(1);
  });

  it("ignores unknown project ids", () => {
    const bundle = makeBundle(makeProject("a"), []);
    addPRToBundle([bundle], "missing", makePR(1));
    expect(bundle.prs).toHaveLength(0);
  });
});
