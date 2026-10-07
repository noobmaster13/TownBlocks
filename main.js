import { authToken, setAuthToken } from './state.js';
import { apiRequest } from './api.js';
import { startAsLoggedInUser, showAuthOverlay } from './auth.js';

// Importing from auth.js above is what pulls in the whole module graph
// (auth.js imports game.js, game.js imports auth.js back) — everything's
// event listeners get wired up as a side effect of this import chain,
// same as the old single script running top-to-bottom.

(async function init() {
  if (!authToken) {
    showAuthOverlay();
    return;
  }
  try {
    const data = await apiRequest('/api/auth/me');
    startAsLoggedInUser(data.user.username);
  } catch (err) {
    // Saved token is invalid/expired — clear it and fall back to the login screen.
    setAuthToken(null);
    localStorage.removeItem('cityBlocksToken');
    showAuthOverlay();
  }
})();
