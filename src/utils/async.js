/**
 * Express 4 does not forward rejected promises from async handlers to the
 * error middleware, so any thrown error becomes an unhandled rejection and
 * takes the whole process down. Wrapping every handler keeps failures inside
 * the request lifecycle where `errorHandler` can turn them into a response.
 */
export const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
