/** 建物のあるタイルを 1 にした占有グリッド（size×size、行は y、座標は中心原点） */
export function occupancy(size: number, buildings: readonly { x: number; y: number }[]) {
  const h = size / 2;
  const grid = new Uint8Array(size * size);
  for (const b of buildings) grid[(b.y + h) * size + b.x + h] = 1;
  return grid;
}

export type Bfs = ReturnType<typeof bfs>;

/**
 * グリッド BFS。座標は中心原点（-size/2 .. size/2-1）。
 * blocked なタイルには到達できるが、そこから先へは進まない（出発タイルだけは例外）。
 * squeeze を渡すと（猫）、blocked なタイルも通り抜けられる。通り抜けるタイルから出る一歩は 1 + squeeze かかるので、空いた道があればそちらを選ぶ。
 * 通り抜けた途中のタイルごとに数えるので、dist は出発点と到着点を入れ替えても同じ
 */
export function bfs(size: number, blocked: Uint8Array, sx: number, sy: number, squeeze = -1) {
  const h = size / 2;
  const n = size * size;
  const dist = new Int16Array(n).fill(-1);
  const prev = new Int16Array(n);
  const queue = new Int16Array(n);
  const idx = (x: number, y: number) => (y + h) * size + (x + h);
  const cell = (i: number) => ({ x: (i % size) - h, y: Math.floor(i / size) - h });
  let tail = 0;
  const start = idx(sx, sy);
  dist[start] = 0;
  if (squeeze < 0) {
    queue[tail++] = start;
    const visit = (j: number, i: number) => {
      if (dist[j] !== -1) return;
      dist[j] = dist[i] + 1;
      prev[j] = i;
      queue[tail++] = j;
    };
    for (let q = 0; q < tail; q++) {
      const i = queue[q];
      if (q > 0 && blocked[i]) continue;
      const x = i % size;
      // 隣の順番（+x, -x, +y, -y）は経路の選び方に効くので変えない
      if (x + 1 < size) visit(i + 1, i);
      if (x > 0) visit(i - 1, i);
      if (i + size < n) visit(i + size, i);
      if (i >= size) visit(i - size, i);
    }
  } else {
    // 一歩の重みが 1 か 1 + squeeze の小さな整数なので、距離ごとのバケツで回す（Dial 法）。
    // 同じ距離の中は入れた順に取り出すので、すり抜けのない盤面では上の BFS と同じ経路になる
    const K = squeeze + 2;
    const buckets: number[][] = Array.from({ length: K }, () => []);
    let pending = 0;
    const relax = (j: number, i: number, nd: number) => {
      if (dist[j] !== -1 && dist[j] <= nd) return;
      dist[j] = nd;
      prev[j] = i;
      buckets[nd % K].push(j);
      pending++;
    };
    buckets[0].push(start);
    pending = 1;
    const done = new Uint8Array(n);
    for (let d = 0; pending > 0; d++) {
      const b = buckets[d % K];
      for (let k = 0; k < b.length; k++) {
        const i = b[k];
        pending--;
        if (done[i] || dist[i] !== d) continue;
        done[i] = 1;
        queue[tail++] = i;
        const nd = d + (i !== start && blocked[i] ? 1 + squeeze : 1);
        const x = i % size;
        if (x + 1 < size) relax(i + 1, i, nd);
        if (x > 0) relax(i - 1, i, nd);
        if (i + size < n) relax(i + size, i, nd);
        if (i >= size) relax(i - size, i, nd);
      }
      b.length = 0;
    }
  }
  return {
    /** 訪れたタイル番号（近い順、建物のタイルも含む） */
    order: () => queue.subarray(0, tail),
    /** タイル番号 → 座標 */
    cell,
    /** 到達不能なら -1 */
    dist: (x: number, y: number) => dist[idx(x, y)],
    /** 出発タイルを除いた経路。到達不能なら null */
    path(x: number, y: number): { x: number; y: number }[] | null {
      let i = idx(x, y);
      if (dist[i] === -1) return null;
      const out = [];
      while (dist[i] > 0) {
        out.push(cell(i));
        i = prev[i];
      }
      return out.reverse();
    },
    /** (x, y) から出発点へ戻る経路（(x, y) を除き、出発点を含む）。到達不能なら null */
    pathBack(x: number, y: number): { x: number; y: number }[] | null {
      let i = idx(x, y);
      if (dist[i] === -1) return null;
      const out = [];
      while (dist[i] > 0) {
        i = prev[i];
        out.push(cell(i));
      }
      return out;
    },
  };
}
