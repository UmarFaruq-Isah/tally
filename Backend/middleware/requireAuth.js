/** 401 unless passport put a user with an `id` on the request. */
export default function requireAuth(req, res, next) {
  if (req.user && req.user.id) return next();
  res.status(401).json({ message: 'Not signed in' });
}
