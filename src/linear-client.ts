import type { LinearIssue, SprintConfig } from "./types.js";

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface IssuesQueryData {
  issues: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      identifier: string;
      title: string;
      description: string | null;
      state: { name: string; type: string };
      project: { id: string; name: string; url: string; state: string; progress: number } | null;
      assignee: { name: string } | null;
      completedAt: string | null;
      attachments: {
        nodes: Array<{ url: string; title: string; sourceType: string }>;
      };
      labels: { nodes: Array<{ name: string }> };
    }>;
  };
}

interface ProjectsQueryData {
  projects: {
    nodes: Array<{
      name: string;
      state: string;
      progress: number;
      description: string | null;
      startDate: string | null;
      targetDate: string | null;
      projectUpdates: {
        nodes: Array<{ body: string; createdAt: string; health: string }>;
      };
    }>;
  };
}

const ISSUES_QUERY = `
query CompletedIssues($teamKey: String!, $after: DateTimeOrDuration!, $before: DateTimeOrDuration!, $email: String!, $cursor: String) {
  issues(
    filter: {
      team: { key: { eq: $teamKey } }
      assignee: { email: { eq: $email } }
      completedAt: { gte: $after, lte: $before }
    }
    first: 100
    after: $cursor
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier
      title
      description
      state { name type }
      project { id name url state progress }
      assignee { name }
      completedAt
      attachments { nodes { url title sourceType } }
      labels { nodes { name } }
    }
  }
}
`;

const PROJECTS_QUERY = `
query ActiveProjects($teamKey: String!, $after: DateTimeOrDuration!, $before: DateTimeOrDuration!, $email: String!) {
  projects(
    filter: {
      state: { in: ["started", "planned"] }
      issues: {
        team: { key: { eq: $teamKey } }
        assignee: { email: { eq: $email } }
        completedAt: { gte: $after, lte: $before }
      }
    }
  ) {
    nodes {
      name
      state
      progress
      description
      startDate
      targetDate
      projectUpdates(first: 1) {
        nodes {
          body
          createdAt
          health
        }
      }
    }
  }
}
`;

async function graphqlRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

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

export async function fetchCompletedIssues(
  config: SprintConfig,
  linearEmails: string[],
  startDate: string,
  endDate: string,
  verbose: boolean = false,
): Promise<LinearIssue[]> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LINEAR_API_KEY not set. Get one from Linear > Settings > API > Personal API Keys",
    );
  }

  const allIssues: LinearIssue[] = [];

  for (const teamKey of config.linearTeamKeys) {
    for (const email of linearEmails) {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      if (verbose) {
        console.error(`[linear] Fetching issues for team ${teamKey}, user ${email}, cursor: ${cursor ?? "start"}`);
      }

      const data: IssuesQueryData = await graphqlRequest<IssuesQueryData>(apiKey, ISSUES_QUERY, {
        teamKey,
        after: `${startDate}T00:00:00.000Z`,
        before: `${endDate}T23:59:59.999Z`,
        email,
        cursor,
      });

      for (const node of data.issues.nodes) {
        const attachmentNodes = node.attachments.nodes;
        const labelNodes = node.labels.nodes;
        allIssues.push({
          identifier: node.identifier,
          title: node.title,
          description: node.description ?? "",
          status: node.state.name,
          statusType: node.state.type,
          projectName: node.project?.name ?? null,
          projectId: node.project?.id ?? null,
          projectUrl: node.project?.url ?? null,
          projectProgress: node.project?.progress ?? null,
          projectState: node.project?.state ?? null,
          assigneeName: node.assignee?.name ?? null,
          completedAt: node.completedAt,
          prUrls: attachmentNodes
            .filter((a: { sourceType: string; url: string }) => a.sourceType === "github" || a.url.includes("github.com"))
            .map((a: { url: string }) => a.url),
          labels: labelNodes.map((l: { name: string }) => l.name),
        });
      }

      hasMore = data.issues.pageInfo.hasNextPage;
      cursor = data.issues.pageInfo.endCursor;
    }
    } // end linearEmails loop

    if (verbose) {
      console.error(`[linear] Team ${teamKey}: ${allIssues.length} completed issues`);
    }
  }

  return allIssues;
}

export interface ProjectUpdate {
  body: string;
  createdAt: string;
  health: string;
}

export interface ProjectMeta {
  name: string;
  state: string;
  progress: number;
  description: string | null;
  startDate: string | null;
  targetDate: string | null;
  latestUpdate: ProjectUpdate | null;
}

export async function fetchActiveProjects(
  config: SprintConfig,
  linearEmails: string[],
  startDate: string,
  endDate: string,
  verbose: boolean = false,
): Promise<ProjectMeta[]> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY not set.");
  }

  const allProjects: ProjectMeta[] = [];

  for (const teamKey of config.linearTeamKeys) {
    for (const email of linearEmails) {
    if (verbose) {
      console.error(`[linear] Fetching active projects for team ${teamKey}, user ${email}`);
    }

    const data = await graphqlRequest<ProjectsQueryData>(apiKey, PROJECTS_QUERY, {
      teamKey,
      after: `${startDate}T00:00:00.000Z`,
      before: `${endDate}T23:59:59.999Z`,
      email,
    });

    for (const node of data.projects.nodes) {
      if (!allProjects.some((p) => p.name === node.name)) {
        const latestUpdateNode = node.projectUpdates.nodes[0] ?? null;
        allProjects.push({
          name: node.name,
          state: node.state,
          progress: node.progress,
          description: node.description,
          startDate: node.startDate,
          targetDate: node.targetDate,
          latestUpdate: latestUpdateNode ? {
            body: latestUpdateNode.body,
            createdAt: latestUpdateNode.createdAt,
            health: latestUpdateNode.health,
          } : null,
        });
      }
    }

    } // end linearEmails loop

    if (verbose) {
      console.error(`[linear] Team ${teamKey}: ${allProjects.length} active projects`);
    }
  }

  return allProjects;
}
