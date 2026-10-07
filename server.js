require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// google auth updates
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
app.use(cors());
app.use(express.json());

// Serves index.html/style.css/*.js from this same folder.
app.use(express.static(__dirname));

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'replace_this_with_a_long_random_string') {
  console.warn(
    'WARNING: JWT_SECRET is missing or still the placeholder value. ' +
    'Set a real random string in your .env before using this anywhere real.'
  );
}

const SALT_ROUNDS = 10;

// -------Auth middleware---------
// Expects "Authorization: Bearer <token>". Attaches req.userId on success.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- Signup --------------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: 'username must be 3-50 characters' });
  }
  // Deliberately loose check — just "something@something.something".
  // Real verification (confirmation email/click-through link) is a
  // separate feature; this only catches obvious typos.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'That doesn\u2019t look like a valid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email.toLowerCase(), passwordHash]
    );
    const user = result.rows[0];

    // Every new user gets a stats row up front, so later UPDATE queries
    // (see /api/game/score) always have a row to update rather than
    // needing an upsert every time.
    await pool.query('INSERT INTO player_stats (user_id) VALUES ($1)', [user.id]);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    if (err.code === '23505') {
      // Postgres unique_violation — figure out which column tripped it
      // so the message actually helps the person fix the form.
      const field = err.constraint && err.constraint.includes('email') ? 'email' : 'username';
      return res.status(409).json({ error: `That ${field} is already taken` });
    }
    console.error('signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account' });
  }
});

// --- Login ---------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE username = $1',
      [username]
    );
    const user = result.rows[0];

    // Deliberately vague error for both "no such user" and "wrong password"
    // so a login attempt can't be used to enumerate valid usernames.
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.password_hash) {
      // Account exists but was created via Google Sign-In — no password
      // to check against. Point them at the right method instead of a
      // generic (and misleading) "invalid password".
      return res.status(401).json({ error: 'This account uses Google Sign-In — use the Google button instead' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Something went wrong logging in' });
  }
});

// --- Google Auth ---------------------------------------------------------------
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'Google token is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const { sub: googleId, email, name } = ticket.getPayload();

    // Check if user already exists
    let result = await pool.query(
      'SELECT id, username, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    let user = result.rows[0];

    // If new user, create their account and stats row
    if (!user) {
      // Generate a unique username since your schema requires it to be UNIQUE
      const baseName = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'Player';
      const username = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;

      const insertResult = await pool.query(
        'INSERT INTO users (username, email, google_id) VALUES ($1, $2, $3) RETURNING id, username, email',
        [username, email.toLowerCase(), googleId]
      );
      user = insertResult.rows[0];

      // Mirroring the standard signup flow to prevent stats updates from failing
      await pool.query('INSERT INTO player_stats (user_id) VALUES ($1)', [user.id]);
    }

    // Mirroring your standard login token generation
    const jwtToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token: jwtToken, user: { id: user.id, username: user.username, email: user.email } });

  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// --- Current user info -----------------------------------------------------
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// --- Save / load in-progress game state -------------------------------------
app.get('/api/game/state', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT grid_state, building_queue, score, updated_at FROM game_saves WHERE user_id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ save: null });
    }
    res.json({ save: result.rows[0] });
  } catch (err) {
    console.error('load state error:', err);
    res.status(500).json({ error: 'Something went wrong loading your save' });
  }
});

app.put('/api/game/state', requireAuth, async (req, res) => {
  const { gridState, buildingQueue, score } = req.body || {};

  if (!gridState || !buildingQueue || typeof score !== 'number') {
    return res.status(400).json({ error: 'gridState, buildingQueue, and score are required' });
  }

  try {
    await pool.query(
      `INSERT INTO game_saves (user_id, grid_state, building_queue, score, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id)
       DO UPDATE SET grid_state = $2, building_queue = $3, score = $4, updated_at = now()`,
      [req.userId, JSON.stringify(gridState), JSON.stringify(buildingQueue), score]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('save state error:', err);
    res.status(500).json({ error: 'Something went wrong saving your game' });
  }
});

// --- Record a finished game's score + stats, and clear the in-progress save ---
app.post('/api/game/score', requireAuth, async (req, res) => {
  const { score, highestTier, mergeCount, buildingsPlaced } = req.body || {};

  if (typeof score !== 'number' || score < 0) {
    return res.status(400).json({ error: 'A valid score is required' });
  }
  // The stats fields are optional (default to 0) so this endpoint still
  // works if an older client only ever sends { score }.
  const safeHighestTier = Number.isInteger(highestTier) ? highestTier : 0;
  const safeMergeCount = Number.isInteger(mergeCount) ? mergeCount : 0;
  const safeBuildingsPlaced = Number.isInteger(buildingsPlaced) ? buildingsPlaced : 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('INSERT INTO high_scores (user_id, score) VALUES ($1, $2)', [req.userId, score]);
    await client.query('DELETE FROM game_saves WHERE user_id = $1', [req.userId]);

    // player_stats row is created at signup, so this is always an UPDATE,
    // never an insert — GREATEST(...) keeps best_score/highest_tier_reached
    // as running maximums rather than overwriting them.
    await client.query(
      `UPDATE player_stats SET
         games_played = games_played + 1,
         total_score = total_score + $2,
         best_score = GREATEST(best_score, $2),
         highest_tier_reached = GREATEST(highest_tier_reached, $3),
         total_merges = total_merges + $4,
         total_buildings_placed = total_buildings_placed + $5,
         updated_at = now()
       WHERE user_id = $1`,
      [req.userId, score, safeHighestTier, safeMergeCount, safeBuildingsPlaced]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('record score error:', err);
    res.status(500).json({ error: 'Something went wrong recording your score' });
  } finally {
    client.release();
  }
});

// --- Lifetime stats for the logged-in player ---------------------------------
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM player_stats WHERE user_id = $1', [req.userId]);
    if (result.rows.length === 0) {
      // Shouldn't happen (row is created at signup) but don't 500 if it does.
      return res.json({ stats: null });
    }
    res.json({ stats: result.rows[0] });
  } catch (err) {
    console.error('stats error:', err);
    res.status(500).json({ error: 'Something went wrong loading your stats' });
  }
});


// --- Public config for the frontend ----------------------------------------
// GOOGLE_CLIENT_ID is a public value (Google's docs confirm it's safe to
// expose — it identifies your app, it isn't a secret), so serving it here
// means it only has to be set in one place (.env) instead of also being
// hardcoded into index.html/main.js and risking the two drifting apart.
app.get('/api/config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});


// --- Leaderboard: top 10 scores, with username, best score per user -----------
app.get('/api/leaderboard', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.username, MAX(h.score) AS best_score
       FROM high_scores h
       JOIN users u ON u.id = h.user_id
       GROUP BY u.username
       ORDER BY best_score DESC
       LIMIT 10`
    );
    res.json({ leaderboard: result.rows });
  } catch (err) {
    console.error('leaderboard error:', err);
    res.status(500).json({ error: 'Something went wrong loading the leaderboard' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`City Blocks API listening on http://localhost:${PORT}`);
});
