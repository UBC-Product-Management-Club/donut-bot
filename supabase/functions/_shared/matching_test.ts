/** Run with `deno test` from supabase/functions. */

import { maxWeightMatching } from "./blossom.ts";
import { computeMatches, type PastMatch } from "./matching.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Edge = [number, number, number];

/** Exhaustively find the best (cardinality, weight) over all matchings. */
function bruteForce(n: number, edges: Edge[], maxCardinality: boolean): [number, number] {
  let best: [number, number] = [0, 0];
  const used = new Array<boolean>(n).fill(false);
  const better = (a: [number, number], b: [number, number]) =>
    maxCardinality ? a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) : a[1] > b[1];
  const go = (k: number, card: number, weight: number) => {
    if (better([card, weight], best)) best = [card, weight];
    for (let e = k; e < edges.length; e++) {
      const [i, j, w] = edges[e];
      if (used[i] || used[j]) continue;
      used[i] = used[j] = true;
      go(e + 1, card + 1, weight + w);
      used[i] = used[j] = false;
    }
  };
  go(0, 0, 0);
  return best;
}

function score(edges: Edge[], mate: number[]): [number, number] {
  let card = 0;
  let weight = 0;
  for (const [i, j, w] of edges) {
    if (mate[i] === j) {
      assert(mate[j] === i, "mate is not symmetric");
      card++;
      weight += w;
    }
  }
  const matchedVertices = mate.filter((m) => m !== -1).length;
  assert(matchedVertices === 2 * card, "mate uses an edge that doesn't exist");
  return [card, weight];
}

Deno.test("blossom matches brute force on random graphs", () => {
  const random = mulberry32(42);
  for (let iter = 0; iter < 1500; iter++) {
    const n = 2 + Math.floor(random() * 9);
    const density = 0.3 + random() * 0.7;
    const maxW = random() < 0.5 ? 3 : 50; // small range forces lots of ties
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (random() < density) edges.push([i, j, 1 + Math.floor(random() * maxW)]);
      }
    }
    for (const maxCardinality of [true, false]) {
      const mate = maxWeightMatching(edges, maxCardinality);
      const got = score(edges, mate);
      const want = bruteForce(n, edges, maxCardinality);
      if (maxCardinality) {
        assert(got[0] === want[0] && got[1] === want[1], `iter ${iter}: got ${got}, want ${want}`);
      } else {
        assert(got[1] === want[1], `iter ${iter} (no max-card): got ${got[1]}, want ${want[1]}`);
      }
    }
  }
});

const NOW = new Date("2026-10-12T09:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const sameGroup = (groups: string[][], a: string, b: string) =>
  groups.some((g) => g.includes(a) && g.includes(b));

Deno.test("avoids a repeat that greedy matching can fall into", () => {
  // A-B met last week; nobody else has met. Optimal is A-C/B-D or A-D/B-C, never A-B.
  const history: PastMatch[] = [{ participant_ids: ["A", "B"], matched_at: daysAgo(7) }];
  const people = ["A", "B", "C", "D"].map((id) => ({ id, location: "vancouver" }));
  for (let seed = 0; seed < 50; seed++) {
    const { groups } = computeMatches(people, history, [], { now: NOW, random: mulberry32(seed) });
    assert(groups.length === 2, "expected two pairs");
    assert(!sameGroup(groups, "A", "B"), `seed ${seed}: A and B were re-paired`);
  }
});

Deno.test("when repeats are forced, older repeats beat a back-to-back one", () => {
  // 2 people only; they must be paired regardless of history
  const people = ["A", "B"].map((id) => ({ id, location: "vancouver" }));
  const history: PastMatch[] = [{ participant_ids: ["A", "B"], matched_at: daysAgo(1) }];
  const { groups, unmatched } = computeMatches(people, history, [], { now: NOW });
  assert(groups.length === 1 && unmatched.length === 0, "a forced repeat should still pair them");

  // A-B met yesterday, C-D met a year ago, every cross pair met a month ago
  const four = ["A", "B", "C", "D"].map((id) => ({ id, location: "vancouver" }));
  const h2: PastMatch[] = [
    { participant_ids: ["A", "B"], matched_at: daysAgo(1) },
    { participant_ids: ["C", "D"], matched_at: daysAgo(365) },
    { participant_ids: ["A", "C"], matched_at: daysAgo(30) },
    { participant_ids: ["B", "D"], matched_at: daysAgo(30) },
    { participant_ids: ["A", "D"], matched_at: daysAgo(30) },
    { participant_ids: ["B", "C"], matched_at: daysAgo(30) },
  ];
  const r2 = computeMatches(four, h2, [], { now: NOW });
  assert(!sameGroup(r2.groups, "A", "B"), "should not re-pair yesterday's match");
});

Deno.test("never pairs across locations", () => {
  const people = [
    ...["V1", "V2", "V3", "V4"].map((id) => ({ id, location: "vancouver" })),
    ...["T1", "T2"].map((id) => ({ id, location: "toronto" })),
    ...["X1", "X2", "X3"].map((id) => ({ id, location: "virtual" })),
  ];
  const loc = new Map(people.map((p) => [p.id, p.location]));
  for (let seed = 0; seed < 20; seed++) {
    const { groups, unmatched } = computeMatches(people, [], [], { now: NOW, random: mulberry32(seed) });
    assert(unmatched.length === 0, "everyone should be matched");
    for (const g of groups) {
      assert(new Set(g.map((id) => loc.get(id))).size === 1, `mixed locations: ${g}`);
    }
    assert(groups.some((g) => g.length === 3 && g[0].startsWith("X")), "virtual should form a trio");
  }
});

Deno.test("odd one out joins a trio; lone person in a location is unmatched", () => {
  const people = [
    ...["A", "B", "C", "D", "E"].map((id) => ({ id, location: "vancouver" })),
    { id: "T1", location: "toronto" },
  ];
  const { groups, unmatched } = computeMatches(people, [], [], { now: NOW });
  assert(groups.length === 2, "5 people → one pair + one trio");
  assert(groups.filter((g) => g.length === 3).length === 1, "expected exactly one trio");
  assert(unmatched.length === 1 && unmatched[0] === "T1", "lone Torontonian should be unmatched");
});

Deno.test("respects the avoid list, including when forming trios", () => {
  const people = ["A", "B", "C", "D", "E"].map((id) => ({ id, location: "vancouver" }));
  const avoid: [string, string][] = [["A", "B"], ["A", "C"], ["E", "B"], ["E", "D"]];
  for (let seed = 0; seed < 50; seed++) {
    const { groups } = computeMatches(people, [], avoid, { now: NOW, random: mulberry32(seed) });
    for (const [a, b] of avoid) {
      assert(!sameGroup(groups, a, b), `seed ${seed}: ${a} and ${b} were grouped`);
    }
  }
});

Deno.test("is repeat-free for the first rounds of a simulated season", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `U${i}`);
  const people = ids.map((id) => ({ id, location: "vancouver" }));
  const history: PastMatch[] = [];
  const seen = new Set<string>();
  // after k rounds everyone has 19-k unmet people; while that's >= 10 (n/2), Dirac's theorem
  // guarantees a repeat-free pairing exists, so the optimal matcher must find it
  for (let round = 0; round < 8; round++) {
    const now = new Date(NOW.getTime() + round * 7 * 86_400_000);
    const { groups } = computeMatches(people, history, [], { now, random: mulberry32(round) });
    for (const [a, b] of groups) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      assert(!seen.has(key), `round ${round}: ${key} repeated`);
      seen.add(key);
      history.push({ participant_ids: [a, b], matched_at: now.toISOString() });
    }
  }
});
