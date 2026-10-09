/**
 * Donut pairing: per location, find the pairing that minimises total "repeat cost"
 * using maximum weight matching, then fold any leftover person into a trio.
 */

import { maxWeightMatching } from "./blossom.ts";

export interface Candidate {
  id: string;
  location: string;
}

export interface PastMatch {
  participant_ids: string[];
  matched_at: string;
}

export interface MatchResult {
  groups: string[][];
  unmatched: string[];
}

export interface MatchOptions {
  now?: Date;
  random?: () => number;
}

/** A meeting today costs this much; cost falls off as 1 / (1 + weeks since). */
const MEETING_COST = 1000;
/** Edge weight = MAX_WEIGHT - cost, so higher weight = fresher pair. */
const MAX_WEIGHT = 10_000;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Repeat cost per pair: sum over past meetings of MEETING_COST / (1 + weeks ago).
 * Never met = 0. Met last week = 500, a month ago ≈ 190, a year ago ≈ 19.
 * Steep for recent meetings, so one back-to-back repeat always costs more than
 * a couple of month-old repeats.
 */
export function buildPairCosts(history: PastMatch[], now: Date): Map<string, number> {
  const costs = new Map<string, number>();
  for (const m of history) {
    const weeksAgo = Math.max(0, (now.getTime() - new Date(m.matched_at).getTime()) / (7 * 86_400_000));
    const cost = MEETING_COST / (1 + weeksAgo);
    const ids = m.participant_ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i], ids[j]);
        costs.set(key, (costs.get(key) ?? 0) + cost);
      }
    }
  }
  return costs;
}

export function computeMatches(
  candidates: Candidate[],
  history: PastMatch[],
  avoidPairs: [string, string][],
  { now = new Date(), random = Math.random }: MatchOptions = {}
): MatchResult {
  const costs = buildPairCosts(history, now);
  const avoid = new Set(avoidPairs.map(([a, b]) => pairKey(a, b)));
  const cost = (a: string, b: string) => costs.get(pairKey(a, b)) ?? 0;
  const allowed = (a: string, b: string) => a !== b && !avoid.has(pairKey(a, b));

  const byLocation = new Map<string, string[]>();
  for (const c of candidates) {
    const ids = byLocation.get(c.location) ?? [];
    if (!ids.includes(c.id)) ids.push(c.id);
    byLocation.set(c.location, ids);
  }

  const groups: string[][] = [];
  const unmatched: string[] = [];

  for (const location of [...byLocation.keys()].sort()) {
    // shuffle so ties (e.g. everyone new) don't produce the same pairs every time
    const ids = shuffle(byLocation.get(location)!, random);

    const edges: [number, number, number][] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!allowed(ids[i], ids[j])) continue;
        const weight = MAX_WEIGHT - Math.min(Math.round(cost(ids[i], ids[j])), MAX_WEIGHT - 1);
        edges.push([i, j, weight]);
      }
    }

    // max cardinality first (pair as many people as possible), then fewest repeats
    const mate = maxWeightMatching(edges, true);

    const pairs: string[][] = [];
    const leftovers: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const m = mate[i] ?? -1;
      if (m === -1) leftovers.push(ids[i]);
      else if (i < m) pairs.push([ids[i], ids[m]]);
    }

    // leftover joins the pair they'd add the least repeat cost to (one extra per pair)
    for (const x of leftovers) {
      let best: string[] | null = null;
      let bestCost = Infinity;
      for (const pair of pairs) {
        if (pair.length !== 2 || !pair.every((p) => allowed(x, p))) continue;
        const c = pair.reduce((sum, p) => sum + cost(x, p), 0);
        if (c < bestCost) {
          best = pair;
          bestCost = c;
        }
      }
      if (best) best.push(x);
      else unmatched.push(x);
    }

    groups.push(...pairs);
  }

  return { groups, unmatched };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
