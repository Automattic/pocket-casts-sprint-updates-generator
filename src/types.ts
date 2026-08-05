export type ReportStatus = "In Progress" | "Complete" | "Paused";

export interface GitHubPR {
  number: number;
  title: string;
  url: string;
  body: string;
  closedAt: string;
  author: string;
  repository: string;
  platform: string;
  labels: string[];
  linearRefs: string[];
}

export interface LinearTicket {
  identifier: string;
  title: string;
  teamKey: string;
  projectId: string | null;
}

export interface LinearProjectUpdate {
  body: string;
  health: string;
  createdAt: string;
}

export interface LinearInitiative {
  id: string;
  name: string;
  url: string;
}

export interface LinearProject {
  id: string;
  name: string;
  url: string;
  teamKeys: string[];
  platform: string;
  status: ReportStatus;
  progress: number;
  description: string | null;
  targetDate: string | null;
  initiative: LinearInitiative | null;
  latestUpdate: LinearProjectUpdate | null;
}

export interface ProjectBundle {
  project: LinearProject;
  prs: GitHubPR[];
  tickets: LinearTicket[];
}

export interface ReportPR {
  title: string;
  url: string;
  number: number;
}

export interface ReportProject {
  projectName: string;
  projectUrl: string | null;
  platform: string;
  status: ReportStatus;
  summary: string;
  prs: ReportPR[];
}

export interface ReportInitiative {
  initiativeName: string | null;
  initiativeUrl: string | null;
  projects: ReportProject[];
}

export interface OtherItem {
  title: string;
  url: string;
}

export interface TopItem {
  headline: string;
  platform: string;
}

export interface SprintReport {
  startDate: string;
  endDate: string;
  topItems: TopItem[];
  initiatives: ReportInitiative[];
  otherByPlatform: Record<string, OtherItem[]>;
}

export interface MemberConfig {
  linear: string;
  name: string;
}

export interface AIConfig {
  provider: "groq" | "openai" | "ollama" | "anthropic";
  model: string;
}

export interface SprintCadence {
  anchorDate: string;
  durationWeeks: number;
}

export interface PromptConfig {
  projectSummary?: string;
  topItems?: string;
  orphanPairing?: string;
  additionalInstructions?: string;
}

export interface SprintConfig {
  githubOrg: string;
  repoPrefix: string;
  teamKeyPlatformMap: Record<string, string>;
  members: Record<string, MemberConfig>;
  defaultAuthor: string;
  ai: AIConfig;
  sprint: SprintCadence;
  prompts?: PromptConfig;
  repoPlatformMap: Record<string, string>;
}

export interface ResolvedAuthors {
  githubAuthors: string[];
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
