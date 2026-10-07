import {
  authToken, setAuthToken,
  isGuest, setIsGuest,
  grid, setGrid,
  score, setScore,
  buildingQueue, setBuildingQueue,
  mergeCountThisGame,
  buildingsPlacedThisGame,
  SIZE,
} from './state.js';
import { scoreValueEl } from './dom.js';
import { apiRequest } from './api.js';
import { beginGame, fillQueue } from './game.js';

// NOTE on the circular import above: game.js also imports
// `autosaveState` and `recordFinalScore` from this file. See the
// matching note at the top of game.js — safe for the same reason.

export function setAuthError(message) {
  document.getElementById('auth-error').textContent = message || '';
}

export function showAuthOverlay() {
  document.getElementById('auth-overlay').classList.remove('hidden');
}

function hideAuthOverlay() {
  document.getElementById('auth-overlay').classList.add('hidden');
}

function renderAccountBar(username) {
  const bar = document.getElementById('account-bar');
  if (isGuest) {
    bar.innerHTML = `Playing as guest — <button id="switch-to-login">log in to save progress</button>`;
    document.getElementById('switch-to-login').addEventListener('click', () => {
      setIsGuest(false);
      showAuthOverlay();
    });
  } else {
    bar.innerHTML = `Logged in as <strong>${username}</strong> <button id="logout-btn" class="city-blocks-logout">Log out</button>`;
    document.getElementById('logout-btn').addEventListener('click', () => {
      const wantsToLogout = window.confirm("Are you sure you want to log out? Your current game progress will be lost.");
      
      if (wantsToLogout) {
        logout(); // Only runs if the user clicks "OK"
      }
    });
    }
}

function logout() {
  setAuthToken(null);
  localStorage.removeItem('cityBlocksToken');
  setIsGuest(false);
  document.getElementById('auth-username').value = '';
  document.getElementById('auth-password').value = '';
  setAuthError('');
  showAuthOverlay();
}

// Debounced autosave — called after every placement, but only actually
// hits the network at most once every couple seconds so rapid clicking
// doesn't spam the server.
let saveTimeout = null;
export function autosaveState() {
  if (isGuest || !authToken) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await apiRequest('/api/game/state', {
        method: 'PUT',
        body: JSON.stringify({ gridState: grid, buildingQueue, score }),
      });
    } catch (err) {
      console.warn('Autosave failed:', err.message);
    }
  }, 1500);
}

export async function recordFinalScore() {
  if (isGuest || !authToken) return;
  try {
    let highestTier = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] > highestTier) highestTier = grid[r][c];
      }
    }

    await apiRequest('/api/game/score', {
      method: 'POST',
      body: JSON.stringify({
        score,
        highestTier,
        mergeCount: mergeCountThisGame,
        buildingsPlaced: buildingsPlacedThisGame,
      }),
    });
    loadLeaderboard();
    loadStats();
  } catch (err) {
    console.warn('Recording final score failed:', err.message);
  }
}

async function loadStats() {
  const contentEl = document.getElementById('stats-content');
  if (isGuest || !authToken) {
    contentEl.textContent = 'Log in to track stats.';
    return;
  }
  try {
    const data = await apiRequest('/api/stats');
    renderStatsPanel(data.stats);
  } catch (err) {
    contentEl.textContent = 'Couldn\u2019t load stats.';
    console.warn('Loading stats failed:', err.message);
  }
}

function renderStatsPanel(stats) {
  const contentEl = document.getElementById('stats-content');
  if (!stats) {
    contentEl.textContent = 'No stats yet — play a game!';
    return;
  }
  contentEl.innerHTML = `
    Games played: ${stats.games_played}<br>
    Best score: ${stats.best_score}<br>
    Lifetime score: ${stats.total_score}<br>
    Highest tier: ${stats.highest_tier_reached}<br>
    Total merges: ${stats.total_merges}<br>
    Buildings placed: ${stats.total_buildings_placed}
  `;
}

async function loadLeaderboard() {
  const listEl = document.getElementById('leaderboard-list');
  try {
    const data = await apiRequest('/api/leaderboard');
    if (!data.leaderboard || data.leaderboard.length === 0) {
      listEl.innerHTML = '<li>No scores yet</li>';
      return;
    }
    listEl.innerHTML = data.leaderboard
      .map(row => `<li>${row.username} — ${row.best_score}</li>`)
      .join('');
  } catch (err) {
    listEl.innerHTML = '<li>Couldn\u2019t load (is the server running?)</li>';
  }
}

// Tries to resume a saved game; returns true if it did, so the caller
// can skip the normal fresh-board setup.
async function tryResumeSavedGame() {
  try {
    const data = await apiRequest('/api/game/state');
    if (!data.save) return false;

    setGrid(data.save.grid_state);
    setScore(data.save.score);
    scoreValueEl.textContent = score;
    setBuildingQueue(fillQueue());
    return true;
  } catch (err) {
    console.warn('Loading saved game failed:', err.message);
    return false;
  }
}

export async function startAsLoggedInUser(username) {
  hideAuthOverlay();
  renderAccountBar(username);
  loadLeaderboard();
  loadStats();
  const resumed = await tryResumeSavedGame();
  beginGame(resumed);
}

function startAsGuest() {
  setIsGuest(true);
  hideAuthOverlay();
  renderAccountBar(null);
  loadLeaderboard();
  beginGame(false);
}

// --- Google Auth ---
export async function handleGoogleLogin(googleCredentialResponse) {
  setAuthError('');
  
  try {
    const data = await apiRequest('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ token: googleCredentialResponse.credential }),
    });
    
    setAuthToken(data.token);
    localStorage.setItem('cityBlocksToken', authToken);
    startAsLoggedInUser(data.user.username);
  } catch (err) {
    setAuthError(err.message);
  }
}

// --- Auth form wiring ---
let authMode = 'login'; // or 'signup'

document.getElementById('auth-toggle').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('auth-title').textContent =
    authMode === 'login' ? 'Log in to Town Blocks' : 'Create your Town Blocks account';
  document.getElementById('auth-submit').textContent =
    authMode === 'login' ? 'Log in' : 'Sign up';
  document.getElementById('auth-toggle').textContent =
    authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in';
  document.getElementById('auth-email').style.display = authMode === 'signup' ? 'block' : 'none';
  setAuthError('');
});

document.getElementById('auth-submit').addEventListener('click', async () => {
  const username = document.getElementById('auth-username').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  setAuthError('');

  if (!username || !password || (authMode === 'signup' && !email)) {
    setAuthError(authMode === 'signup'
      ? 'Enter a username, email, and password.'
      : 'Enter a username and password.');
    return;
  }

  try {
    const path = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
    const payload = authMode === 'login' ? { username, password } : { username, email, password };
    const data = await apiRequest(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(data.token);
    localStorage.setItem('cityBlocksToken', authToken);
    startAsLoggedInUser(data.user.username);
  } catch (err) {
    setAuthError(err.message);
  }
});

document.getElementById('auth-guest').addEventListener('click', startAsGuest);

// Each panel toggles independently (both can be open at once, or neither).
// Data is re-fetched every time a panel is opened, so it's always current
// rather than showing whatever was last loaded at login.
document.getElementById('toggle-leaderboard-btn').addEventListener('click', (e) => {
  const panel = document.getElementById('leaderboard-panel');
  const nowOpen = panel.classList.toggle('open');
  e.target.classList.toggle('active', nowOpen);
  if (nowOpen) loadLeaderboard();
});

document.getElementById('toggle-stats-btn').addEventListener('click', (e) => {
  const panel = document.getElementById('stats-panel');
  const nowOpen = panel.classList.toggle('open');
  e.target.classList.toggle('active', nowOpen);
  if (nowOpen) loadStats();
});

// Make the Google auth handler available globally for the HTML script
window.handleGoogleLogin = handleGoogleLogin;   //Google's script looks for a global function named handleGoogleLogin to pass the login data to.