/**
 * Maximum weight matching in a general graph (Edmonds' blossom algorithm, O(n^3)).
 * Port of Joris van Rantwijk's public-domain mwmatching.py.
 *
 * @param edges [i, j, weight] with vertices numbered 0..n-1
 * @param maxCardinality only consider matchings with the most possible edges
 * @returns mate[v] = vertex matched to v, or -1
 */
export function maxWeightMatching(
  edges: [number, number, number][],
  maxCardinality = false
): number[] {
  if (edges.length === 0) return [];

  const nedge = edges.length;
  let nvertex = 0;
  for (const [i, j] of edges) {
    nvertex = Math.max(nvertex, i + 1, j + 1);
  }
  const maxweight = Math.max(0, ...edges.map((e) => e[2]));

  // endpoint[p] is the vertex at endpoint p; edge k has endpoints 2k and 2k+1
  const endpoint: number[] = [];
  for (let p = 0; p < 2 * nedge; p++) endpoint.push(edges[p >> 1][p % 2]);

  // neighbend[v] lists the remote endpoints of edges attached to v
  const neighbend: number[][] = Array.from({ length: nvertex }, () => []);
  edges.forEach(([i, j], k) => {
    neighbend[i].push(2 * k + 1);
    neighbend[j].push(2 * k);
  });

  const mate = new Array<number>(nvertex).fill(-1);
  // label: 0 = free, 1 = S, 2 = T (5 = S marked during scanBlossom)
  const label = new Array<number>(2 * nvertex).fill(0);
  const labelend = new Array<number>(2 * nvertex).fill(-1);
  const inblossom = Array.from({ length: nvertex }, (_, v) => v);
  const blossomparent = new Array<number>(2 * nvertex).fill(-1);
  const blossomchilds: (number[] | null)[] = new Array(2 * nvertex).fill(null);
  const blossombase = [
    ...Array.from({ length: nvertex }, (_, v) => v),
    ...new Array<number>(nvertex).fill(-1),
  ];
  const blossomendps: (number[] | null)[] = new Array(2 * nvertex).fill(null);
  const bestedge = new Array<number>(2 * nvertex).fill(-1);
  const blossombestedges: (number[] | null)[] = new Array(2 * nvertex).fill(null);
  const unusedblossoms = Array.from({ length: nvertex }, (_, i) => nvertex + i);
  const dualvar = [
    ...new Array<number>(nvertex).fill(maxweight),
    ...new Array<number>(nvertex).fill(0),
  ];
  const allowedge = new Array<boolean>(nedge).fill(false);
  let queue: number[] = [];

  const slack = (k: number) => {
    const [i, j, wt] = edges[k];
    return dualvar[i] + dualvar[j] - 2 * wt;
  };

  const blossomLeaves = (b: number): number[] => {
    if (b < nvertex) return [b];
    const leaves: number[] = [];
    for (const t of blossomchilds[b]!) {
      if (t < nvertex) leaves.push(t);
      else leaves.push(...blossomLeaves(t));
    }
    return leaves;
  };

  const assignLabel = (w: number, t: number, p: number): void => {
    const b = inblossom[w];
    label[w] = label[b] = t;
    labelend[w] = labelend[b] = p;
    bestedge[w] = bestedge[b] = -1;
    if (t === 1) {
      queue.push(...blossomLeaves(b));
    } else if (t === 2) {
      const base = blossombase[b];
      assignLabel(endpoint[mate[base]], 1, mate[base] ^ 1);
    }
  };

  // Trace back from v and w to find a new blossom (returns its base) or an augmenting path (-1).
  const scanBlossom = (v: number, w: number): number => {
    const path: number[] = [];
    let base = -1;
    while (v !== -1 || w !== -1) {
      let b = inblossom[v];
      if (label[b] & 4) {
        base = blossombase[b];
        break;
      }
      path.push(b);
      label[b] = 5;
      if (labelend[b] === -1) {
        v = -1;
      } else {
        v = endpoint[labelend[b]];
        b = inblossom[v];
        v = endpoint[labelend[b]];
      }
      if (w !== -1) [v, w] = [w, v];
    }
    for (const b of path) label[b] = 1;
    return base;
  };

  const addBlossom = (base: number, k: number): void => {
    let [v, w] = edges[k];
    const bb = inblossom[base];
    let bv = inblossom[v];
    let bw = inblossom[w];
    const b = unusedblossoms.pop()!;
    blossombase[b] = base;
    blossomparent[b] = -1;
    blossomparent[bb] = b;
    let path: number[] = [];
    let endps: number[] = [];
    while (bv !== bb) {
      blossomparent[bv] = b;
      path.push(bv);
      endps.push(labelend[bv]);
      v = endpoint[labelend[bv]];
      bv = inblossom[v];
    }
    path.push(bb);
    path = path.reverse();
    endps = endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomparent[bw] = b;
      path.push(bw);
      endps.push(labelend[bw] ^ 1);
      w = endpoint[labelend[bw]];
      bw = inblossom[w];
    }
    blossomchilds[b] = path;
    blossomendps[b] = endps;
    label[b] = 1;
    labelend[b] = labelend[bb];
    dualvar[b] = 0;
    for (const leaf of blossomLeaves(b)) {
      if (label[inblossom[leaf]] === 2) queue.push(leaf);
      inblossom[leaf] = b;
    }

    // compute the new blossom's least-slack edges to neighbouring S-blossoms
    const bestedgeto = new Array<number>(2 * nvertex).fill(-1);
    for (const child of path) {
      const nblists = blossombestedges[child] === null
        ? blossomLeaves(child).map((leaf) => neighbend[leaf].map((p) => p >> 1))
        : [blossombestedges[child]!];
      for (const nblist of nblists) {
        for (const ek of nblist) {
          let [i, j] = edges[ek];
          if (inblossom[j] === b) [i, j] = [j, i];
          const bj = inblossom[j];
          if (
            bj !== b && label[bj] === 1 &&
            (bestedgeto[bj] === -1 || slack(ek) < slack(bestedgeto[bj]))
          ) {
            bestedgeto[bj] = ek;
          }
        }
      }
      blossombestedges[child] = null;
      bestedge[child] = -1;
    }
    blossombestedges[b] = bestedgeto.filter((ek) => ek !== -1);
    bestedge[b] = -1;
    for (const ek of blossombestedges[b]!) {
      if (bestedge[b] === -1 || slack(ek) < slack(bestedge[b])) bestedge[b] = ek;
    }
  };

  const expandBlossom = (b: number, endstage: boolean): void => {
    const childs = blossomchilds[b]!;
    for (const s of childs) {
      blossomparent[s] = -1;
      if (s < nvertex) inblossom[s] = s;
      else if (endstage && dualvar[s] === 0) expandBlossom(s, endstage);
      else for (const leaf of blossomLeaves(s)) inblossom[leaf] = s;
    }

    // expanding a T-blossom mid-stage: relabel the sub-blossoms on the path through it
    if (!endstage && label[b] === 2) {
      const endps = blossomendps[b]!;
      const at = (idx: number) => (idx < 0 ? idx + childs.length : idx);
      const entrychild = inblossom[endpoint[labelend[b] ^ 1]];
      let j = childs.indexOf(entrychild);
      let jstep: number;
      let endptrick: number;
      if (j & 1) {
        j -= childs.length;
        jstep = 1;
        endptrick = 0;
      } else {
        jstep = -1;
        endptrick = 1;
      }
      let p = labelend[b];
      while (j !== 0) {
        label[endpoint[p ^ 1]] = 0;
        label[endpoint[endps[at(j - endptrick)] ^ endptrick ^ 1]] = 0;
        assignLabel(endpoint[p ^ 1], 2, p);
        allowedge[endps[at(j - endptrick)] >> 1] = true;
        j += jstep;
        p = endps[at(j - endptrick)] ^ endptrick;
        allowedge[p >> 1] = true;
        j += jstep;
      }
      let bv = childs[at(j)];
      label[endpoint[p ^ 1]] = label[bv] = 2;
      labelend[endpoint[p ^ 1]] = labelend[bv] = p;
      bestedge[bv] = -1;
      j += jstep;
      while (childs[at(j)] !== entrychild) {
        bv = childs[at(j)];
        if (label[bv] === 1) {
          j += jstep;
          continue;
        }
        const labelled = blossomLeaves(bv).find((leaf) => label[leaf] !== 0);
        if (labelled !== undefined) {
          label[labelled] = 0;
          label[endpoint[mate[blossombase[bv]]]] = 0;
          assignLabel(labelled, 2, labelend[labelled]);
        }
        j += jstep;
      }
    }

    label[b] = labelend[b] = -1;
    blossomchilds[b] = blossomendps[b] = null;
    blossombase[b] = -1;
    blossombestedges[b] = null;
    bestedge[b] = -1;
    unusedblossoms.push(b);
  };

  // Swap matched/unmatched edges along the alternating path inside blossom b from v to its base.
  const augmentBlossom = (b: number, v: number): void => {
    let t = v;
    while (blossomparent[t] !== b) t = blossomparent[t];
    if (t >= nvertex) augmentBlossom(t, v);
    const childs = blossomchilds[b]!;
    const endps = blossomendps[b]!;
    const at = (idx: number) => (idx < 0 ? idx + childs.length : idx);
    const i = childs.indexOf(t);
    let j = i;
    let jstep: number;
    let endptrick: number;
    if (i & 1) {
      j -= childs.length;
      jstep = 1;
      endptrick = 0;
    } else {
      jstep = -1;
      endptrick = 1;
    }
    while (j !== 0) {
      j += jstep;
      t = childs[at(j)];
      const p = endps[at(j - endptrick)] ^ endptrick;
      if (t >= nvertex) augmentBlossom(t, endpoint[p]);
      j += jstep;
      t = childs[at(j)];
      if (t >= nvertex) augmentBlossom(t, endpoint[p ^ 1]);
      mate[endpoint[p]] = p ^ 1;
      mate[endpoint[p ^ 1]] = p;
    }
    blossomchilds[b] = [...childs.slice(i), ...childs.slice(0, i)];
    blossomendps[b] = [...endps.slice(i), ...endps.slice(0, i)];
    blossombase[b] = blossombase[blossomchilds[b]![0]];
  };

  const augmentMatching = (k: number): void => {
    const [v, w] = edges[k];
    for (let [s, p] of [[v, 2 * k + 1], [w, 2 * k]]) {
      while (true) {
        const bs = inblossom[s];
        if (bs >= nvertex) augmentBlossom(bs, s);
        mate[s] = p;
        if (labelend[bs] === -1) break;
        const t = endpoint[labelend[bs]];
        const bt = inblossom[t];
        s = endpoint[labelend[bt]];
        const j = endpoint[labelend[bt] ^ 1];
        if (bt >= nvertex) augmentBlossom(bt, j);
        mate[j] = labelend[bt];
        p = labelend[bt] ^ 1;
      }
    }
  };

  // each stage either augments the matching by one edge or proves it's maximal
  for (let stage = 0; stage < nvertex; stage++) {
    label.fill(0);
    bestedge.fill(-1);
    blossombestedges.fill(null, nvertex);
    allowedge.fill(false);
    queue = [];

    for (let v = 0; v < nvertex; v++) {
      if (mate[v] === -1 && label[inblossom[v]] === 0) assignLabel(v, 1, -1);
    }

    let augmented = false;
    while (true) {
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!;
        for (const p of neighbend[v]) {
          const k = p >> 1;
          const w = endpoint[p];
          if (inblossom[v] === inblossom[w]) continue;
          let kslack = 0;
          if (!allowedge[k]) {
            kslack = slack(k);
            if (kslack <= 0) allowedge[k] = true;
          }
          if (allowedge[k]) {
            if (label[inblossom[w]] === 0) {
              assignLabel(w, 2, p ^ 1);
            } else if (label[inblossom[w]] === 1) {
              const base = scanBlossom(v, w);
              if (base >= 0) {
                addBlossom(base, k);
              } else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (label[w] === 0) {
              label[w] = 2;
              labelend[w] = p ^ 1;
            }
          } else if (label[inblossom[w]] === 1) {
            const b = inblossom[v];
            if (bestedge[b] === -1 || kslack < slack(bestedge[b])) bestedge[b] = k;
          } else if (label[w] === 0) {
            if (bestedge[w] === -1 || kslack < slack(bestedge[w])) bestedge[w] = k;
          }
        }
      }
      if (augmented) break;

      // no augmenting path yet: find the smallest dual change that makes progress
      let deltatype = -1;
      let delta = 0;
      let deltaedge = -1;
      let deltablossom = -1;

      if (!maxCardinality) {
        deltatype = 1;
        delta = Math.min(...dualvar.slice(0, nvertex));
      }
      for (let v = 0; v < nvertex; v++) {
        if (label[inblossom[v]] === 0 && bestedge[v] !== -1) {
          const d = slack(bestedge[v]);
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 2;
            deltaedge = bestedge[v];
          }
        }
      }
      for (let b = 0; b < 2 * nvertex; b++) {
        if (blossomparent[b] === -1 && label[b] === 1 && bestedge[b] !== -1) {
          const d = slack(bestedge[b]) / 2;
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 3;
            deltaedge = bestedge[b];
          }
        }
      }
      for (let b = nvertex; b < 2 * nvertex; b++) {
        if (
          blossombase[b] >= 0 && blossomparent[b] === -1 && label[b] === 2 &&
          (deltatype === -1 || dualvar[b] < delta)
        ) {
          delta = dualvar[b];
          deltatype = 4;
          deltablossom = b;
        }
      }
      if (deltatype === -1) {
        // max-cardinality mode with no further progress possible: final dual update
        deltatype = 1;
        delta = Math.max(0, Math.min(...dualvar.slice(0, nvertex)));
      }

      for (let v = 0; v < nvertex; v++) {
        if (label[inblossom[v]] === 1) dualvar[v] -= delta;
        else if (label[inblossom[v]] === 2) dualvar[v] += delta;
      }
      for (let b = nvertex; b < 2 * nvertex; b++) {
        if (blossombase[b] >= 0 && blossomparent[b] === -1) {
          if (label[b] === 1) dualvar[b] += delta;
          else if (label[b] === 2) dualvar[b] -= delta;
        }
      }

      if (deltatype === 1) {
        break;
      } else if (deltatype === 2) {
        allowedge[deltaedge] = true;
        let [i, j] = edges[deltaedge];
        if (label[inblossom[i]] === 0) [i, j] = [j, i];
        queue.push(i);
      } else if (deltatype === 3) {
        allowedge[deltaedge] = true;
        queue.push(edges[deltaedge][0]);
      } else if (deltatype === 4) {
        expandBlossom(deltablossom, false);
      }
    }

    if (!augmented) break;

    // end of stage: expand S-blossoms whose dual hit zero
    for (let b = nvertex; b < 2 * nvertex; b++) {
      if (blossomparent[b] === -1 && blossombase[b] >= 0 && label[b] === 1 && dualvar[b] === 0) {
        expandBlossom(b, true);
      }
    }
  }

  for (let v = 0; v < nvertex; v++) {
    if (mate[v] >= 0) mate[v] = endpoint[mate[v]];
  }
  return mate;
}
