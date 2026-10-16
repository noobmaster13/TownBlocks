// Pure game rules — no DOM, no shared state, no network. Everything here
// takes a grid and returns results, so the exact same rules drive real play
// (game.js) and the AI's look-ahead (ai.js). One copy of the rules means the
// AI can never "think" the game works differently than it actually does.

export const SIZE = 5;
export const MAX_TIER = 7;
export const MAX_SPAWN_TIER = 5; // Tiers 6 & 7 can NEVER drop from the queue — only reached by merging

// Relative spawn weights per tier (tiers above MAX_SPAWN_TIER never spawn).
export const TIER_WEIGHTS = { 1: 20, 2: 25, 3: 30, 4: 20, 5: 5 };

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Random source: Math.random by default. Experiments can swap in a seeded
// generator so runs are reproducible.
let rand = Math.random;
export function setRandomSource(fn) { rand = fn; }
export function random() { return rand(); }

export function createEmptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

export function cloneGrid(grid) {
  return grid.map(row => row.slice());
}

export function getEmptyCells(grid) {
  const cells = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (grid[r][c] === 0) cells.push([r, c]);
    }
  }
  return cells;
}

// In-place Fisher–Yates shuffle using the swappable random source.
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Seeds roughly a third of the board with Tier 1–3 buildings.
export function populateInitialBoard(grid) {
  const coords = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) coords.push([r, c]);
  }
  shuffle(coords);

  const count = Math.floor((grid.length * grid.length) / 3);
  for (let i = 0; i < count; i++) {
    const [r, c] = coords[i];
    const roll = rand();
    let startTier = 1;
    if (roll > 0.85) startTier = 3;
    else if (roll > 0.50) startTier = 2;
    grid[r][c] = startTier;
  }
}

// Weighted random tier. Which tiers can spawn is capped by the highest tier
// currently on the board, and a draw that would make a THIRD identical tier
// in a row (per prevTwo) gets one re-roll.
export function getRandomTier(grid, prevTwo = []) {
  let maxBoardTier = 1;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (grid[r][c] > maxBoardTier) maxBoardTier = grid[r][c];
    }
  }

  const unlockedQueueLimit = Math.min(Math.max(1, maxBoardTier), MAX_SPAWN_TIER);

  function weightedRoll() {
    let totalWeight = 0;
    for (let t = 1; t <= unlockedQueueLimit; t++) totalWeight += TIER_WEIGHTS[t];

    let roll = rand() * totalWeight;
    for (let t = 1; t <= unlockedQueueLimit; t++) {
      if (roll < TIER_WEIGHTS[t]) return t;
      roll -= TIER_WEIGHTS[t];
    }
    return 1;
  }

  let result = weightedRoll();
  const wouldBeThirdInARow =
    prevTwo.length === 2 && prevTwo[0] === prevTwo[1] && result === prevTwo[1];

  if (wouldBeThirdInARow && unlockedQueueLimit > 1) {
    result = weightedRoll();
  }
  return result;
}

export function fillQueue(grid) {
  const q = [];
  for (let i = 0; i < 3; i++) {
    q.push(getRandomTier(grid, q.slice(-2)));
  }
  return q;
}

// BFS over orthogonally-connected cells holding `targetTier`.
export function getConnectedMatchingTiles(grid, startR, startC, targetTier) {
  const n = grid.length;
  const connected = [];
  const visited = Array.from({ length: n }, () => Array(n).fill(false));
  const queue = [[startR, startC]];
  visited[startR][startC] = true;

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    connected.push([r, c]);

    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (
        nr >= 0 && nr < n && nc >= 0 && nc < n &&
        !visited[nr][nc] &&
        grid[nr][nc] === targetTier
      ) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return connected;
}

// Resolves merges starting from (r, c), mutating `grid` in place. A group of
// 3+ connected same-tier buildings clears and upgrades the cell at (r, c) one
// tier, then the new tier is re-checked (chain reactions). Merge points scale
// with the tier reached. Returns { tiers: [tier reached per step], points }.
export function resolveMerges(grid, r, c) {
  const tiers = [];
  let points = 0;

  while (true) {
    const tier = grid[r][c];
    if (tier === 0 || tier >= MAX_TIER) break;

    const group = getConnectedMatchingTiles(grid, r, c, tier);
    if (group.length < 3) break;

    for (const [gr, gc] of group) grid[gr][gc] = 0;
    grid[r][c] = tier + 1;
    tiers.push(tier + 1);
    points += (tier + 1) * 10;
  }
  return { tiers, points };
}

// Places `tier` at (r, c) and resolves merges (mutates `grid`).
// points = placement points (the tier itself) + merge points.
export function applyPlacement(grid, r, c, tier) {
  grid[r][c] = tier;
  const { tiers, points } = resolveMerges(grid, r, c);
  return { points: tier + points, tiers };
}
