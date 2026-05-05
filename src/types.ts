export interface LinearIssue {
  identifier: string;
  title: string;
  description: string;
  status: string;
  statusType: string;
  projectName: string | null;
  projectId: string | null;
  projectUrl: string | null;
  projectProgress: number | null;
  projectState: string | null;
  assigneeName: string | null;
  completedAt: string | null;
  prUrls: string[];
  labels: string[];
}

export interface GitHubPR {
  number: number;
  title: string;
  url: string;
  body: string;
  closedAt: string;
  author: string;
  repository: string;
  labels: string[];
}

export interface ProjectGroup {
  projectName: string;
  projectUrl: string | null;
  projectProgress: number | null;
  projectState: string | null;
  projectDescription: string | null;
  projectTargetDate: string | null;
  projectLatestUpdate: string | null;
  projectHealth: string | null;
  platform: string;
  issues: LinearIssue[];
  prs: GitHubPR[];
}

export interface ProjectSummary {
  projectName: string;
  projectUrl: string | null;
  platform: string;
  summary: string;
  status: "Complete" | "Nearly complete" | "In Progress" | "Started" | "Blocked";
  items: ReportItem[];
}

export interface ReportItem {
  title: string;
  url: string | null;
  linearId: string | null;
}

export interface TopItem {
  headline: string;
  platform: string;
}

export interface SprintReport {
  startDate: string;
  endDate: string;
  topItems: TopItem[];
  projectUpdates: ProjectSummary[];
  otherByPlatform: Record<string, ReportItem[]>;
}

export interface RepoConfig {
  name: string;
  platform: string;
}

export interface MemberConfig {
  linearEmail: string;
  name: string;
}

export interface AIConfig {
  provider: "groq" | "openai" | "ollama" | "anthropic";
  model: string;
}

export interface SprintCadence {
  anchorDate: string;   // A known sprint start date (YYYY-MM-DD, should be a Sunday)
  durationWeeks: number; // Sprint length in weeks (default: 2)
}

export interface SprintConfig {
  githubOrg: string;
  repos: RepoConfig[];
  linearTeamKeys: string[];
  members: Record<string, MemberConfig>;
  defaultAuthor: string;
  ai: AIConfig;
  sprint: SprintCadence;
  repoPlatformMap: Record<string, string>;
}

export interface ResolvedAuthors {
  githubAuthors: string[];
  linearEmails: string[];
}

export interface HistoryEntry {
  startDate: string;
  endDate: string;
  generatedAt: string;
  author: string;
  projectCount: number;
  prCount: number;
  issueCount: number;
}

export interface CorrelatorResult {
  projectGroups: ProjectGroup[];
  unmatchedPRs: GitHubPR[];
}
