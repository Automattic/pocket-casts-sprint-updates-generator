import type {
  GitHubPR,
  LinearProject,
  LinearTicket,
  ProjectBundle,
  SprintConfig,
} from "./types.js";
import { fetchTicketsByIdentifier, fetchProjectsById } from "./linear-client.js";

const LINEAR_REF_PATTERNS = [
  /\b([A-Z]+-\d+)\b/g,
  /linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/g,
];

export function extractLinearRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const pattern of LINEAR_REF_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(regex)) {
      refs.add(match[1] ?? match[0]);
    }
  }
  return [...refs];
}

export interface ResolveResult {
  bundles: ProjectBundle[];
  orphanPRs: GitHubPR[];
}

export interface InitiativeGroup {
  initiativeId: string | null;
  initiativeName: string | null;
  initiativeUrl: string | null;
  bundles: ProjectBundle[];
}

export async function resolve(
  prs: GitHubPR[],
  config: SprintConfig,
  verbose: boolean = false,
): Promise<ResolveResult> {
  const allRefs = [...new Set(prs.flatMap((p) => p.linearRefs))];
  const tickets = allRefs.length ? await fetchTicketsByIdentifier(allRefs, verbose) : [];

  const ticketByIdentifier = new Map<string, LinearTicket>();
  for (const t of tickets) ticketByIdentifier.set(t.identifier, t);

  const projectIds = [
    ...new Set(tickets.map((t) => t.projectId).filter((id): id is string => Boolean(id))),
  ];
  const projects = projectIds.length
    ? await fetchProjectsById(projectIds, config, verbose)
    : new Map<string, LinearProject>();

  const bundles = new Map<string, ProjectBundle>();
  const orphanPRs: GitHubPR[] = [];

  for (const pr of prs) {
    const bundle = firstBundleForPR(pr, ticketByIdentifier, projects, bundles);
    if (!bundle) {
      orphanPRs.push(pr);
    }
  }

  const result = [...bundles.values()];
  for (const bundle of result) {
    bundle.project.platform = resolvePlatform(
      bundle.project.teamKeys,
      config.teamKeyPlatformMap,
      bundle.prs,
    );
  }

  return { bundles: result, orphanPRs };
}

function resolvePlatform(
  teamKeys: string[],
  map: Record<string, string>,
  prs: GitHubPR[],
): string {
  const teamPlatforms = teamKeys.map((k) => map[k]).filter(Boolean);
  const pr = dominantPlatform(prs);
  if (pr !== "Unknown" && teamPlatforms.includes(pr)) return pr;
  if (teamPlatforms.length) return teamPlatforms[0];
  return pr;
}

// A single Linear project can span platform teams (e.g. HLS Support with
// Android + iOS + Web PRs). Split such a bundle into one sub-bundle per platform
// so each renders as its own line with only its own PRs. PRs from shared/tooling
// repos (platform "Other") attach to the project's primary platform rather than
// spawning a separate line.
export function splitBundleByPlatform(
  bundle: ProjectBundle,
  map: Record<string, string>,
): ProjectBundle[] {
  const primary = resolvePlatform(bundle.project.teamKeys, map, bundle.prs);
  const displayPlatform = (pr: GitHubPR): string =>
    pr.platform && pr.platform !== "Other" ? pr.platform : primary;

  const byPlatform = new Map<string, GitHubPR[]>();
  for (const pr of bundle.prs) {
    const plat = displayPlatform(pr);
    (byPlatform.get(plat) ?? byPlatform.set(plat, []).get(plat)!).push(pr);
  }

  if (byPlatform.size <= 1) {
    return [{ ...bundle, project: { ...bundle.project, platform: primary } }];
  }

  const platforms = [...byPlatform.keys()].sort((a, b) =>
    a === primary ? -1 : b === primary ? 1 : a.localeCompare(b),
  );
  return platforms.map((plat) => {
    const prs = byPlatform.get(plat)!;
    return {
      project: { ...bundle.project, platform: plat },
      prs,
      tickets: bundle.tickets.filter((t) =>
        prs.some((pr) => pr.linearRefs.includes(t.identifier)),
      ),
    };
  });
}

function dominantPlatform(prs: GitHubPR[]): string {
  const counts = new Map<string, number>();
  for (const pr of prs) {
    counts.set(pr.platform, (counts.get(pr.platform) ?? 0) + 1);
  }
  const platforms = [...counts.keys()];
  if (platforms.length === 0) return "Unknown";
  if (platforms.length > 1) return "Cross-platform";
  return platforms[0];
}

function firstBundleForPR(
  pr: GitHubPR,
  ticketByIdentifier: Map<string, LinearTicket>,
  projects: Map<string, LinearProject>,
  bundles: Map<string, ProjectBundle>,
): ProjectBundle | null {
  for (const ref of pr.linearRefs) {
    const ticket = ticketByIdentifier.get(ref);
    if (!ticket?.projectId) continue;
    const project = projects.get(ticket.projectId);
    if (!project) continue;

    const bundle = ensureBundle(bundles, project);
    if (!bundle.prs.some((p) => p.url === pr.url)) bundle.prs.push(pr);
    if (!bundle.tickets.some((t) => t.identifier === ticket.identifier)) {
      bundle.tickets.push(ticket);
    }
    return bundle;
  }
  return null;
}

function ensureBundle(
  bundles: Map<string, ProjectBundle>,
  project: LinearProject,
): ProjectBundle {
  let bundle = bundles.get(project.id);
  if (!bundle) {
    bundle = { project, prs: [], tickets: [] };
    bundles.set(project.id, bundle);
  }
  return bundle;
}

export function addPRToBundle(bundles: ProjectBundle[], projectId: string, pr: GitHubPR): void {
  const bundle = bundles.find((b) => b.project.id === projectId);
  if (bundle && !bundle.prs.some((p) => p.url === pr.url)) {
    bundle.prs.push(pr);
  }
}

export function groupBundlesByInitiative(bundles: ProjectBundle[]): InitiativeGroup[] {
  const groups = new Map<string, InitiativeGroup>();
  const standalone: InitiativeGroup[] = [];

  for (const bundle of bundles) {
    const initiative = bundle.project.initiative;
    if (!initiative) {
      standalone.push({
        initiativeId: null,
        initiativeName: null,
        initiativeUrl: null,
        bundles: [bundle],
      });
      continue;
    }
    let group = groups.get(initiative.id);
    if (!group) {
      group = {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
        initiativeUrl: initiative.url,
        bundles: [],
      };
      groups.set(initiative.id, group);
    }
    group.bundles.push(bundle);
  }

  const sortByPRs = (g: InitiativeGroup) =>
    g.bundles.reduce((n, b) => n + b.prs.length, 0);
  return [...groups.values(), ...standalone].sort((a, b) => sortByPRs(b) - sortByPRs(a));
}
