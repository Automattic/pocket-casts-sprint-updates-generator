import type {
  LinearTicket,
  LinearProject,
  LinearInitiative,
  LinearProjectUpdate,
  ReportStatus,
  SprintConfig,
} from "./types.js";

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface RawIssueNode {
  identifier: string;
  title: string;
  team: { key: string } | null;
  project: { id: string } | null;
}

interface RawProjectNode {
  id: string;
  name: string;
  url: string;
  state: string | null;
  status: { name: string; type: string } | null;
  progress: number | null;
  description: string | null;
  targetDate: string | null;
  teams: { nodes: Array<{ key: string; name: string }> };
  initiatives: { nodes: Array<{ id: string; name: string; url: string }> };
  projectUpdates: { nodes: Array<{ body: string; health: string; createdAt: string }> };
}

const IDENTIFIER_CHUNK = 50;
const PROJECT_CHUNK = 50;

function getApiKey(): string {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LINEAR_API_KEY not set. Get one from Linear > Settings > Account > Security & Access",
    );
  }
  return apiKey;
}

async function graphqlRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }

    const json = (await response.json()) as GraphQLResponse<T>;

    if (!response.ok) {
      const errDetail = json.errors?.map((e) => e.message).join(", ") ?? JSON.stringify(json);
      throw new Error(`Linear API error ${response.status}: ${errDetail}`);
    }
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    return json.data;
  }
  throw new Error("Linear API error: rate limited after retries");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const ISSUES_BY_REF_QUERY = `
query IssuesByRef($filter: IssueFilter!) {
  issues(filter: $filter, first: 250) {
    nodes { identifier title team { key } project { id } }
  }
}`;

function parseIdentifier(id: string): { teamKey: string; number: number } | null {
  const dash = id.lastIndexOf("-");
  if (dash === -1) return null;
  const teamKey = id.slice(0, dash);
  const number = Number(id.slice(dash + 1));
  if (!teamKey || !Number.isInteger(number)) return null;
  return { teamKey, number };
}

export async function fetchTicketsByIdentifier(
  identifiers: string[],
  verbose: boolean = false,
): Promise<LinearTicket[]> {
  const apiKey = getApiKey();
  const parsed = [...new Set(identifiers)]
    .map((id) => parseIdentifier(id))
    .filter((p): p is { teamKey: string; number: number } => p !== null);
  const tickets: LinearTicket[] = [];

  for (const group of chunk(parsed, IDENTIFIER_CHUNK)) {
    const filter = {
      or: group.map((p) => ({ and: [{ team: { key: { eq: p.teamKey } } }, { number: { eq: p.number } }] })),
    };

    if (verbose) {
      console.error(`[linear] Resolving ${group.length} ticket identifiers`);
    }

    const data = await graphqlRequest<{ issues: { nodes: RawIssueNode[] } }>(
      apiKey,
      ISSUES_BY_REF_QUERY,
      { filter },
    );

    for (const node of data.issues.nodes) {
      tickets.push({
        identifier: node.identifier,
        title: node.title,
        teamKey: node.team?.key ?? node.identifier.split("-")[0],
        projectId: node.project?.id ?? null,
      });
    }
  }

  return tickets;
}

const PROJECTS_BY_ID_QUERY = `
query ProjectsById($ids: [ID!]!) {
  projects(filter: { id: { in: $ids } }, first: 250) {
    nodes {
      id
      name
      url
      state
      status { name type }
      progress
      description
      targetDate
      teams(first: 5) { nodes { key name } }
      initiatives(first: 5) { nodes { id name url } }
      projectUpdates(first: 1) { nodes { body health createdAt } }
    }
  }
}`;

export async function fetchProjectsById(
  projectIds: string[],
  config: SprintConfig,
  verbose: boolean = false,
): Promise<Map<string, LinearProject>> {
  const apiKey = getApiKey();
  const unique = [...new Set(projectIds)];
  const projects = new Map<string, LinearProject>();

  for (const group of chunk(unique, PROJECT_CHUNK)) {
    if (verbose) {
      console.error(`[linear] Fetching ${group.length} projects`);
    }

    const data = await graphqlRequest<{ projects: { nodes: RawProjectNode[] } }>(
      apiKey,
      PROJECTS_BY_ID_QUERY,
      { ids: group },
    );

    for (const node of data.projects.nodes) {
      const teamKeys = node.teams.nodes.map((t) => t.key);
      const initiativeNode = node.initiatives.nodes[0];
      const updateNode = node.projectUpdates.nodes[0];

      const initiative: LinearInitiative | null = initiativeNode
        ? { id: initiativeNode.id, name: initiativeNode.name, url: initiativeNode.url }
        : null;
      const latestUpdate: LinearProjectUpdate | null = updateNode
        ? { body: updateNode.body, health: updateNode.health, createdAt: updateNode.createdAt }
        : null;

      projects.set(node.id, {
        id: node.id,
        name: node.name,
        url: node.url,
        teamKeys,
        platform: pickPlatform(teamKeys, config.teamKeyPlatformMap),
        status: mapStatus(node.status?.type ?? node.state),
        progress: node.progress ?? 0,
        description: node.description,
        targetDate: node.targetDate,
        initiative,
        latestUpdate,
      });
    }
  }

  return projects;
}

function pickPlatform(teamKeys: string[], map: Record<string, string>): string {
  for (const key of teamKeys) {
    if (map[key]) return map[key];
  }
  return "Unknown";
}

function mapStatus(raw: string | null | undefined): ReportStatus {
  const value = (raw ?? "").toLowerCase();
  if (value === "completed") return "Complete";
  if (value === "paused" || value === "canceled" || value === "cancelled") return "Paused";
  return "In Progress";
}
