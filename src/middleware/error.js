export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
}

export function errorHandler(error, req, res, next) {
  console.error(error);
  res.status(error.statusCode || 500).json({ message: error.message || 'Unexpected server error.' });
}