import { Router } from 'express';
import passport from 'passport';
import { googleEnabled } from '../auth.js';

// Mounted at /api by routes/index.js. Pages live in /Frontend, so redirects point there.
const router = Router();
const ready = (req, res, next) =>
  googleEnabled ? next() : res.status(503).json({ message: 'Google sign-in is not configured on this server.' });

router.get('/auth/google', ready, passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));

router.get(
  '/auth/google/callback',
  ready,
  passport.authenticate('google', { failureRedirect: '/Frontend/login.html' }),
  (req, res) => res.redirect('/Frontend/dashboard.html'),
);

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Not signed in' });
  const { id, email, name, provider } = req.user;
  res.json({ id, email, name, provider });
});

router.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('tally.sid');
      res.json({ ok: true });
    });
  });
});

export default router;
