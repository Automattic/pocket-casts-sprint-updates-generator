import type { SprintConfig } from "./types.js";

export const DEFAULT_CONFIG: SprintConfig = {
  githubOrg: "Automattic",
  repoPrefix: "pocket-casts",
  teamKeyPlatformMap: {
    PCDROID: "Android",
    PCIOS: "iOS",
    PCWEB: "Web",
    PCSERVER: "Server",
  },
  members: {
    sztomek: { linear: "tamas.szelezsan", name: "Tamas Szelezsan" },
    geekygecko: { linear: "philip.simpson", name: "Philip Simpson" },
    leandroalonso: { linear: "leandro.alonso", name: "Leandro Alonso" },
    "msurdi-a8c": { linear: "matias.surdi", name: "Matias Surdi" },
    psrpinto: { linear: "psrpinto", name: "Pedro Pinto" },
    srjakes: { linear: "simon.jacobs", name: "Simon Jacobs" },
    SergioEstevao: { linear: "sergio.estevao", name: "Sergio Estevao" },
    kean: { linear: "alex.grebenyuk", name: "Alex Grebenyuk" },
  },
  defaultAuthor: "sztomek",
  ai: {
    provider: "anthropic",
    model: "claude-sonnet-5",
  },
  sprint: {
    anchorDate: "2026-04-26",
    durationWeeks: 2,
  },
  repoPlatformMap: {},
};
