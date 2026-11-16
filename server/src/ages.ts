// Age ratings: the youngest age a film or series is meant for, from TMDb's certifications (the
// country of the server's language first, then Denmark, the US, the UK, Germany...) or a .nfo's
// <mpaa>. People with an age limit only see what's rated at or below it; something with no
// rating at all is left out for them too (an admin can give it one in Fix details).
import { setting } from "./db.ts";

/** The limits a person can have (null = no limit). The Danish Media Council's ages. */
export const LIMITS = [0, 7, 11, 15] as const;

const TABLES: Record<string, Record<string, number>> = {
  US: {
    G: 0, PG: 7, "PG-13": 13, R: 17, "NC-17": 18,
    "TV-Y": 0, "TV-Y7": 7, "TV-G": 0, "TV-PG": 10, "TV-14": 14, "TV-MA": 17,
  },
  GB: { U: 0, UC: 0, PG: 8, "12": 12, "12A": 12, "15": 15, "18": 18, R18: 18 },
  DK: { A: 0, "7": 7, "11": 11, "15": 15, F: 0 },
  AU: { G: 0, PG: 8, M: 15, "MA15+": 15, "R18+": 18, X18: 18 },
  NL: { AL: 0 },
  SE: { BTL: 0 },
  FR: { U: 0, TP: 0 },
};

/** "PG-13", "DK:11", "Rated R", "FSK 12" → an age; null when it can't tell. */
export function ageOf(cert: string | undefined | null, country = ""): number | null {
  if (!cert) return null;
  let c = String(cert).trim().replace(/^rated\s+/i, "");
  const pre = c.match(/^([A-Za-z]{2})(?::\s*|\s+)(.+)$/);
  if (pre) {
    country = pre[1].toUpperCase();
    c = pre[2].trim().replace(/^rated\s+/i, "");
  }
  if (!c || /^(nr|not rated|unrated|n\/a)$/i.test(c)) return null;
  const up = c.toUpperCase();
  const own = TABLES[country.toUpperCase()]?.[up];
  if (own !== undefined) return own;
  for (const t of Object.values(TABLES)) if (t[up] !== undefined) return t[up];
  const n = up.match(/(\d{1,2})/);
  return n ? Math.min(Number(n[1]), 18) : null;
}

function countries(): string[] {
  const region = String(setting("language") || "en-US").split("-")[1]?.toUpperCase() ?? "";
  return [...new Set([region, "DK", "US", "GB", "DE", "SE", "NO", "NL", "FR", "AU"].filter(Boolean))];
}

/** From TMDb's [{country, certification}] list: the first country (in our order) that has one. */
export function pick(list: { country: string; cert: string }[]): { cert: string; age: number } | null {
  const order = countries();
  const ranked = [...list].filter((x) => x.cert).sort((a, b) => rank(order, a.country) - rank(order, b.country));
  for (const x of ranked) {
    const age = ageOf(x.cert, x.country);
    if (age !== null) return { cert: `${x.country} ${x.cert}`, age };
  }
  return null;
}

function rank(order: string[], c: string): number {
  const i = order.indexOf(c);
  return i < 0 ? order.length : i;
}

/** What a person with this limit may see: films and series rated at or below it. */
export function allows(limit: number | null | undefined, age: unknown): boolean {
  if (limit === null || limit === undefined) return true;
  return typeof age === "number" && age <= limit;
}

export function label(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return "Anything";
  return limit === 0 ? "For everyone" : `Age ${limit}`;
}
