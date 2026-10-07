import {
  SIZE, MAX_TIER, MAX_SPAWN_TIER, BUILDING_SPRITES,
  grid, setGrid,
  buildingQueue, setBuildingQueue,
  gameOver, setGameOver,
  score, setScore,
  mergeCountThisGame, setMergeCount,
  buildingsPlacedThisGame, setBuildingsPlacedCount,
} from './state.js';
import {
  boardEl, statusEl, scoreValueEl,
  currentPreviewEl, nextPreview1El, nextPreview2El,
  resetBtn,
} from './dom.js';
import { autosaveState, recordFinalScore } from './auth.js';

// NOTE on the circular import above: auth.js also imports `beginGame`
// and `fillQueue` from this file. That's safe — neither module calls
// the other's functions at the top level, only from inside event
// handlers/async functions that run after both modules have finished
// loading and every export is available.

// --- INITIALIZATION ---
export function populateInitialBoard() {
  const totalCells = SIZE * SIZE;
  const initialCellCount = Math.floor(totalCells / 3);  //1/3 of the total cells are filled on the borad

  const coordinates = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      coordinates.push([r, c]);
    }
  }
  coordinates.sort(() => Math.random() - 0.5);

  for (let i = 0; i < initialCellCount; i++) {
    const [r, c] = coordinates[i];
    const roll = Math.random();
    let startTier = 1;
    if (roll > 0.85) startTier = 3;
    else if (roll > 0.50) startTier = 2;

    grid[r][c] = startTier;
  }
}

export function getRandomTier(prevTwo = []) {
  let maxBoardTier = 1;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] > maxBoardTier) maxBoardTier = grid[r][c];
    }
  }

  const tierWeights = {
    1: 20,
    2: 25,
    3: 30,
    4: 20,
    5: 5
  };

  const unlockedQueueLimit = Math.min(
    Math.max(1, maxBoardTier),
    MAX_SPAWN_TIER
  );

  function weightedRoll() {
    let totalWeight = 0;
    for (let t = 1; t <= unlockedQueueLimit; t++) {
      totalWeight += tierWeights[t];
    }

    let roll = Math.random() * totalWeight;
    for (let t = 1; t <= unlockedQueueLimit; t++) {
      if (roll < tierWeights[t]) return t;
      roll -= tierWeights[t];
    }
    return 1;
  }

  // Anti-repeat: two of the same tier in a row is fine — only re-roll
  // when the draw would make it a THIRD in a row (prevTwo holds the
  // last two tiers already placed/queued; if both match each other
  // and the new roll matches too, that's the run we're avoiding).
  let result = weightedRoll();
  const wouldBeThirdInARow =
    prevTwo.length === 2 && prevTwo[0] === prevTwo[1] && result === prevTwo[1];

  if (wouldBeThirdInARow && unlockedQueueLimit > 1) {
    result = weightedRoll();
  }
  return result;
}

export function fillQueue() {
  const q = [];
  for (let i = 0; i < 3; i++) {
    q.push(getRandomTier(q.slice(-2)));
  }
  return q;
}

// --- SCORING ---
// Placing a building is worth its own tier (small, steady trickle).
// Merging is worth far more and scales with the tier reached, since
// reaching higher tiers takes progressively more setup — rewards the
// actual skill/luck of pulling off a merge, not just filling cells.
function addScore(points) {
  setScore(score + points);
  scoreValueEl.textContent = score;
  scoreValueEl.classList.remove('bump');
  // Force reflow so the animation can restart on back-to-back scores
  void scoreValueEl.offsetWidth;
  scoreValueEl.classList.add('bump');
}

export function updateTrayUI() {
  currentPreviewEl.style.backgroundImage = `url('${BUILDING_SPRITES[buildingQueue[0]]}')`;
  nextPreview1El.style.backgroundImage = `url('${BUILDING_SPRITES[buildingQueue[1]]}')`;
  nextPreview2El.style.backgroundImage = `url('${BUILDING_SPRITES[buildingQueue[2]]}')`;
}

export function renderBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (gameOver ? ' locked' : '');
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', () => placeBuilding(r, c));

      const tier = grid[r][c];
      if (tier > 0) {
        const sprite = document.createElement('div');
        const spritePath = BUILDING_SPRITES[tier];

        if (spritePath) {
          sprite.className = 'building-sprite';
          sprite.style.backgroundImage = `url('${spritePath}')`;
        } else {
          sprite.className = 'building-sprite placeholder';
          sprite.textContent = tier;
        }

        cell.appendChild(sprite);
      }

      boardEl.appendChild(cell);
    }
  }
}

// --- MERGE ALGORITHM ---
function getConnectedMatchingTiles(startR, startC, targetTier) {
  const connected = [];
  const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const queue = [[startR, startC]];
  visited[startR][startC] = true;

  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    connected.push([r, c]);

    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;

      if (
        nr >= 0 && nr < SIZE &&
        nc >= 0 && nc < SIZE &&
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

function processMerges(targetR, targetC) {
  let currentR = targetR;
  let currentC = targetC;
  const cascadeTiers = []; // tracks every tier reached in the cascade so
                            // the status line can report the whole chain
                            // instead of only the last hop.

  while (true) {
    const currentTier = grid[currentR][currentC];

    if (currentTier === 0 || currentTier >= MAX_TIER) break;

    const group = getConnectedMatchingTiles(currentR, currentC, currentTier);

    if (group.length >= 3) {
      for (const [r, c] of group) {
        grid[r][c] = 0;
      }

      grid[currentR][currentC] = currentTier + 1;
      cascadeTiers.push(currentTier + 1);
      setMergeCount(mergeCountThisGame + 1);
      addScore((currentTier + 1) * 10);
    } else {
      break;
    }
  }

  if (cascadeTiers.length === 1) {
    statusEl.textContent = `Merge! Upgraded to Tier ${cascadeTiers[0]}. +${cascadeTiers[0] * 10} points.`;
  } else if (cascadeTiers.length > 1) {
    const chainPoints = cascadeTiers.reduce((sum, t) => sum + t * 10, 0);
    statusEl.textContent = `Chain merge! Tier ${cascadeTiers[0]} → Tier ${cascadeTiers[cascadeTiers.length - 1]}. +${chainPoints} points.`;
  }

  return cascadeTiers.length;
}

// --- GAME OVER CHECK ---
function boardHasEmptyCell() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
    }
  }
  return false;
}

export function checkGameOver() {
  if (!boardHasEmptyCell()) {
    setGameOver(true);
    statusEl.textContent = 'Board full — no space left. Game over!';
    statusEl.classList.add('game-over');
    resetBtn.classList.add('visible');
    document.getElementById('scene').classList.add('locked');
    renderBoard();
    recordFinalScore();
  }
}

export function resetGame() {
  setGrid(Array.from({ length: SIZE }, () => Array(SIZE).fill(0)));
  setGameOver(false);
  setScore(0);
  setMergeCount(0);
  setBuildingsPlacedCount(0);
  scoreValueEl.textContent = score;
  statusEl.classList.remove('game-over');
  resetBtn.classList.remove('visible');
  document.getElementById('scene').classList.remove('locked');
  populateInitialBoard();
  setBuildingQueue(fillQueue());
  statusEl.textContent = 'Place 3 matching buildings next to each other to merge!';
  renderBoard();
  updateTrayUI();
  autosaveState();
}

export function placeBuilding(r, c) {
  if (gameOver) return;

  if (grid[r][c] !== 0) {
    statusEl.textContent = 'Cell occupied! Choose an empty cell.';
    return;
  }

  const placedTier = buildingQueue.shift();
  grid[r][c] = placedTier;
  setBuildingsPlacedCount(buildingsPlacedThisGame + 1);
  addScore(placedTier);

  const mergesOccurred = processMerges(r, c);

  if (mergesOccurred === 0) {
    statusEl.textContent = `Placed Tier ${placedTier} building. +${placedTier} points.`;
  }

  buildingQueue.push(getRandomTier(buildingQueue.slice(-2)));
  renderBoard();
  updateTrayUI();
  checkGameOver();
  autosaveState();
}

// Confirm before wiping progress — restarting is available any time now
// (not just at game over), so an accidental click mid-game could lose
// real progress without this check.
resetBtn.addEventListener('click', () => {
  const message = gameOver
    ? 'Start a new game?'
    : 'Restart? Your current board and score will be lost.';
  if (window.confirm(message)) {
    resetGame();
  }
});

// Sets up a fresh board unless resuming a save already populated `grid`
// and `score` (see tryResumeSavedGame in auth.js) — in that case just
// render what was loaded instead of overwriting it with a new board.
export function beginGame(resumed) {
  if (!resumed) {
    setGrid(Array.from({ length: SIZE }, () => Array(SIZE).fill(0)));
    setScore(0);
    scoreValueEl.textContent = score;
    populateInitialBoard();
    setBuildingQueue(fillQueue());
  }
  setMergeCount(0);
  setBuildingsPlacedCount(0);
  setGameOver(false);
  statusEl.classList.remove('game-over');
  resetBtn.classList.remove('visible');
  document.getElementById('scene').classList.remove('locked');
  renderBoard();
  updateTrayUI();
}
