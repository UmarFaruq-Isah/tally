export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
/** Lets async route handlers throw; works on Express 4 and 5. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
/** Express param guard: a malformed id is simply "not found". */
export function uuidParam(name = 'id') {
  return (req, res, next) => (isUuid(req.params[name]) ? next() : next(new HttpError(404, 'Not found')));
}
