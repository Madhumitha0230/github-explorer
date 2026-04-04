require('dotenv').config();

const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────
// DATABASE SETUP (simple file database)
// ─────────────────────────────────────
const adapter = new FileSync('database.json');
const db = low(adapter);

// Set default data
db.defaults({ users: [] }).write();
console.log('✅ Database Ready!');

// ─────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────
app.use(express.static('public'));
app.use(express.json());

// ─────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: "Too many requests!",
    message: "Please wait 15 minutes!"
  }
});

app.use('/api/', limiter);

// ─────────────────────────────────────
// OAUTH ROUTES
// ─────────────────────────────────────
app.get('/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const githubAuthUrl =
    'https://github.com/login/oauth/authorize' +
    '?client_id=' + clientId +
    '&scope=read:user';
  res.redirect(githubAuthUrl);
});

app.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;

  try {
    // Exchange code for token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id:     process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code:          code
      },
      { headers: { Accept: 'application/json' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get GitHub user profile
    const userResponse = await axios.get(
      'https://api.github.com/user',
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );

    const githubUser = userResponse.data;

    // ── Save to database ───────────────
    const existingUser = db.get('users')
      .find({ github_id: String(githubUser.id) })
      .value();

    if (existingUser) {
      // Update existing user
      db.get('users')
        .find({ github_id: String(githubUser.id) })
        .assign({
          last_login:  new Date().toISOString(),
          login_count: existingUser.login_count + 1,
          followers:   githubUser.followers,
          repos:       githubUser.public_repos
        })
        .write();
      console.log('👤 Returning user:', githubUser.login);
      console.log('🔢 Login count:', existingUser.login_count + 1);
    } else {
      // Save new user
      db.get('users')
        .push({
          github_id:   String(githubUser.id),
          username:    githubUser.login,
          name:        githubUser.name,
          location:    githubUser.location,
          avatar:      githubUser.avatar_url,
          repos:       githubUser.public_repos,
          followers:   githubUser.followers,
          following:   githubUser.following,
          last_login:  new Date().toISOString(),
          login_count: 1
        })
        .write();
      console.log('🆕 New user saved:', githubUser.login);
    }

    console.log('💾 Database updated!');
    res.redirect('/?token=' + accessToken);

  } catch (error) {
    console.log('❌ Error:', error.message);
    res.redirect('/?error=login_failed');
  }
});

// ─────────────────────────────────────
// GITHUB API ROUTES
// ─────────────────────────────────────
app.get('/api/user', async (req, res) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({
      error: "Not logged in!",
      message: "Please login first!"
    });
  }

  try {
    const response = await axios.get(
      'https://api.github.com/user',
      { headers: { Authorization: token } }
    );
    res.json(response.data);

  } catch (error) {
    if (error.response?.status === 401) {
      res.status(401).json({
        error: "Invalid token!",
        message: "Please login again!"
      });
    } else if (error.response?.status === 429) {
      res.status(429).json({
        error: "Rate limit exceeded!",
        message: "Too many requests!"
      });
    } else {
      res.status(500).json({
        error: "Server error!",
        message: "Something went wrong!"
      });
    }
  }
});

app.get('/api/repos/:username', async (req, res) => {
  const token    = req.headers.authorization;
  const username = req.params.username;

  try {
    const response = await axios.get(
      'https://api.github.com/users/' + username + '/repos',
      { headers: { Authorization: token } }
    );
    res.json(response.data);

  } catch (error) {
    if (error.response?.status === 404) {
      res.status(404).json({
        error: "User not found!",
        message: username + " doesn't exist!"
      });
    } else {
      res.status(500).json({
        error: "Server error!",
        message: "Could not fetch repos!"
      });
    }
  }
});

app.get('/api/ratelimit', async (req, res) => {
  const token = req.headers.authorization;

  try {
    const response = await axios.get(
      'https://api.github.com/rate_limit',
      { headers: { Authorization: token } }
    );
    res.json(response.data.rate);

  } catch (error) {
    res.status(500).json({
      error: "Could not check rate limit!"
    });
  }
});

// ─────────────────────────────────────
// DATABASE ROUTES
// ─────────────────────────────────────
app.get('/api/users', (req, res) => {
  const users = db.get('users').value();
  res.json({
    total: users.length,
    users: users
  });
});

// ─────────────────────────────────────
// START SERVER
// ─────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 Server is running!');
  console.log('👉 Open: http://localhost:' + PORT);
  console.log('');
});