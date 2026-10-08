import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import passport from 'passport';
import sessionMiddleware from './session.js';
import buildRoutes from './routes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express app.
 *   authRouter  router with /auth/google, /auth/google/callback, /auth/me, /auth/logout
 *   useSession  true = install express-session + passport here (default); false = skip (tests)
 */
export function createApp({ authRouter, useSession = true } = {}) {
  if (!authRouter) throw new Error('createApp needs an authRouter');
  const app = express();
  app.set('trust proxy', 1);                 // Render sits in front of us (needed for secure cookies + HTTPS callback URL)
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));   // CSP off: the pages use inline scripts + Google Fonts

  if (process.env.FRONTEND_ORIGIN) {         // only when the UI is served from another origin
    app.use(cors({ origin: process.env.FRONTEND_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  }
  app.use(express.json({ limit: '100kb' }));

  if (useSession) {
    app.use(sessionMiddleware());
    app.use(passport.initialize());
    app.use(passport.session());
  }

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many requests. Please slow down.' } }));
  app.use('/api', buildRoutes(authRouter));

  // ---- The website: same layout as the repo (and GitHub Pages) ----
  //   /                     -> index.html  (repo root)
  //   /Frontend/*           -> pages, css, js
  // Only these are public. Backend/ (code, .env) is never served.
  const root = process.env.SITE_DIR || path.join(here, '..');
  const indexFile = path.join(root, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.get(['/', '/index.html'], (req, res) => res.sendFile(indexFile));
    app.use('/Frontend', express.static(path.join(root, 'Frontend'), { dotfiles: 'ignore' }));
    // Clean URLs from the blueprint
    for (const page of ['login', 'dashboard', 'settings']) app.get('/' + page, (req, res) => res.redirect(`/Frontend/${page}.html`));
    app.get('/task/new', (req, res) => res.redirect('/Frontend/dashboard.html#/task/new'));
    app.get('/task/:id/edit', (req, res) => res.redirect('/Frontend/dashboard.html#/task/' + encodeURIComponent(req.params.id) + '/edit'));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status === 500) console.error(err);
    if (!req.path.startsWith('/api')) return res.status(status).send(status === 500 ? 'Something went wrong' : err.message);
    res.status(status).json({ message: status === 500 ? 'Something went wrong' : err.message });
  });
  return app;
}
