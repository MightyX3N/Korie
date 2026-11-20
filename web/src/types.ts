// What the server sends.

export interface PersonBrief { id: string; name: string; color: string; hasPin: boolean; admin: boolean }

export interface Person extends PersonBrief {
  canSettings: boolean; addons: "all" | string[]; audio: string; subs: string; skipIntro: "button" | "auto" | "off";
  music: boolean; canInstall: boolean; canDelete: boolean; apps: "all" | string[]; maxAge: number | null; autoDevice: string | null; autoPin: boolean; household: string;
}

export interface Me { person: Person; server: { name: string; version: string; id: string }; games: boolean; languages: [string, string][] }

export interface Card {
  id: string; kind: string; title: string; subtitle: string; year: string; poster: string; thumb: string; backdrop: string;
  progress: number; watched: boolean; source: string; overview?: string; genres?: string[]; rating?: number; runtime?: number;
  favourite?: boolean; local?: boolean; series?: string; only?: "film" | "series"; length?: number; album?: string; n?: number; cert?: string; playlist?: string; /** sound only (a radio station): played in the background */ audio?: boolean;
}

export interface Row { id: string; title: string; kind: string; items: Card[]; source?: string }

export interface Episode { id: string; n: number; date?: string; title: string; overview: string; runtime: number; thumb: string; progress: number; watched: boolean; position: number; duration: number }
export interface Season { n: number; title: string; episodes: Episode[] }
export interface Track { id: string; n: number; title: string; artist: string; duration: number; album?: string; albumTitle?: string; poster?: string; /** a radio station */ live?: boolean }

export interface Item {
  id: string; kind: string; title: string; year: string; overview: string; genres: string[]; rating: number; runtime: number; director: string;
  cast: { name: string; role: string; photo: string }[]; poster: string; backdrop: string; thumb: string; favourite: boolean; source: string;
  subtitle?: string; local: boolean; matched?: boolean; cert?: string; age?: number | null; position: number; duration: number; watched: boolean;
  /** a film's editions (Director's Cut, …) and a film's or series' extras (trailers, …) */
  versions?: { id: string; edition: string }[]; edition?: string; extras?: { id: string; title: string; type: string }[];
  seasons?: Season[]; artist?: string; tracks?: Track[]; error?: string; series?: string; seriesTitle?: string; season?: number; episode?: number; disc?: string;
}

export interface Choice { id: string; label: string; lang: string; isDefault: boolean; url?: string; burn?: boolean }

export interface Plan {
  mode: "direct" | "stream"; url: string; duration: number; live: boolean; seekable: boolean; audio: Choice[]; audioIndex: number | null;
  subs: Choice[]; why: string; id: string; title: string; subtitle: string; resume: number; next: string | null;
  intro: { start: number; end: number; auto: boolean } | null; web?: string;
  episode?: { show: string; season: number; episode: number } | null;
  /** a channel made from the library: what's on, and what's next; locked = above the person's age limit */
  channel?: { id: string; name: string; programme: Programme; next: { title: string; start: number } | null };
  locked?: boolean;
}

/** A programme on a channel from the library (the guide; times in seconds since 1970). */
export interface Programme {
  id: string; start: number; end: number; locked: boolean; title: string; subtitle: string; thumb: string; poster: string; overview: string; cert: string;
}

export interface AddonView {
  id: string; name: string; version: string; storeVersion: string; author: string; description: string; games: boolean; installed: boolean;
  builtin: boolean; enabled: boolean; place: "mixed" | "own"; error: string; status: string; busy: boolean; update: boolean; trouble: string; internet: boolean; hosts: string[];
  hostsFromSettings: boolean; hostsFromAccount: boolean; accounts: { who: "house" | "person"; label: string } | null;
  settings: { key: string; label: string; type: "text" | "password" | "list" | "toggle" | "choice"; help?: string; options?: [string, string][]; value: unknown }[]; log: string[];
}
