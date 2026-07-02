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

export async function fetchTicketsByIdentifier(
  identifiers: string[],
  verbose: boolean = false,
): Promise<LinearTicket[]> {
  const apiKey = getApiKey();
  const unique = [...new Set(identifiers)];
  const tickets: LinearTicket[] = [];

  for (const group of chunk(unique, IDENTIFIER_CHUNK)) {
    const fields = group
      .map(
        (id, i) =>
          `i${i}: issue(id: ${JSON.stringify(id)}) { identifier title team { key } project { id } }`,
      )
      .join("\n");
    const query = `query IssuesByIdentifier {\n${fields}\n}`;

    if (verbose) {
      console.error(`[linear] Resolving ${group.length} ticket identifiers`);
    }

    const data = await graphqlRequest<Record<string, RawIssueNode | null>>(apiKey, query);

    for (const node of Object.values(data)) {
      if (!node) continue;
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

const PROJECT_FIELDS = `
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
`;

export async function fetchProjectsById(
  projectIds: string[],
  config: SprintConfig,
  verbose: boolean = false,
): Promise<Map<string, LinearProject>> {
  const apiKey = getApiKey();
  const unique = [...new Set(projectIds)];
  const projects = new Map<string, LinearProject>();

  for (const group of chunk(unique, PROJECT_CHUNK)) {
    const fields = group
      .map((id, i) => `p${i}: project(id: ${JSON.stringify(id)}) {${PROJECT_FIELDS}}`)
      .join("\n");
    const query = `query ProjectsById {\n${fields}\n}`;

    if (verbose) {
      console.error(`[linear] Fetching ${group.length} projects`);
    }

    const data = await graphqlRequest<Record<string, RawProjectNode | null>>(apiKey, query);

    for (const node of Object.values(data)) {
      if (!node) continue;
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
        platform: config.teamKeyPlatformMap[teamKeys[0]] ?? "Unknown",
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

function mapStatus(raw: string | null | undefined): ReportStatus {
  const value = (raw ?? "").toLowerCase();
  if (value === "completed") return "Complete";
  if (value === "paused" || value === "canceled" || value === "cancelled") return "Paused";
  return "In Progress";
}
