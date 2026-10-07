// Shared mutable game state. Other modules import these bindings
// directly for READING — ES module imports are "live", so a read in
// any file always reflects the current value, even after another
// module changes it. But you can only REASSIGN a `let` from the module
// that declares it, so any code that needs to change one of these
// values (not just mutate an array/object in place) must go through
// the matching setter function below.

export const SIZE = 5;
export const MAX_TIER = 7;
export const MAX_SPAWN_TIER = 5; // Tiers 6 & 7 can NEVER drop from queue — only reached by merging

export const BUILDING_SPRITES = {
  1: 'imgs/buildingTiles_103.png',
  2: 'imgs/buildingTiles_121.png',
  3: 'imgs/buildingTiles_024.png',
  4: 'imgs/buildingTiles_003.png',
  5: 'imgs/buildingTiles_014.png',
  6: 'imgs/buildingTiles_026.png',
  7: 'imgs/buildingTiles_022.png'
  // Tier 7 has no entry here on purpose during early testing — it can
  // only appear by merging three tier-6 buildings, never spawned
  // directly. renderBoard() in game.js falls back to a labeled
  // placeholder block when a tier has no sprite mapped yet.
};

export let grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
export function setGrid(newGrid) { grid = newGrid; }

export let buildingQueue = [];
export function setBuildingQueue(newQueue) { buildingQueue = newQueue; }

export let gameOver = false;
export function setGameOver(value) { gameOver = value; }

export let score = 0;
export function setScore(value) { score = value; }

export let mergeCountThisGame = 0;
export function setMergeCount(value) { mergeCountThisGame = value; }

export let buildingsPlacedThisGame = 0;
export function setBuildingsPlacedCount(value) { buildingsPlacedThisGame = value; }

export let authToken = localStorage.getItem('cityBlocksToken') || null;
export function setAuthToken(value) { authToken = value; }

export let isGuest = false;
export function setIsGuest(value) { isGuest = value; }
