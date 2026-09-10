import type { ErrorRequestHandler } from 'express';

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/**
 * Terminal error middleware. Express identifies it by its FOUR-PARAMETER ARITY -
 * dropping `_next` silently turns it into a normal handler that never fires.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const parserError = err as BodyParserError;

  // express.raw rejects bodies over MAX_BODY_SIZE. Nothing was persisted, so the caller
  // must be told explicitly rather than receiving a generic 500.
  if (parserError.type === 'entity.too.large') {
    console.warn(`[listen] body exceeded MAX_BODY_SIZE; nothing recorded (${req.originalUrl})`);
    res.status(413).json({ status: 'TOO_LARGE' });
    return;
  }

  // Log the real error server-side only.
  console.error('[error]', err);

  // VERIFIED: Express's built-in handler writes the full stack trace and absolute
  // filesystem paths into the response body. Never echo the error.
  if (req.path.startsWith('/listen')) {
    res.status(500).json({ status: 'ERROR' });
    return;
  }
  res.status(500).render('error');
};
