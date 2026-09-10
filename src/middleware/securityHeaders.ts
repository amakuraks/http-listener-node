import type { Request, Response, NextFunction } from 'express';

const CSP = [
  "default-src 'self'",
  "script-src 'self'", // no 'unsafe-inline' - all handlers live in /assets/app.js
  "style-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'", // clickjacking
  "form-action 'self'", // a captured payload cannot post a form elsewhere
].join('; ');

/**
 * Defence in depth. EJS `<%= %>` escaping remains the primary XSS control; this is the
 * second line for a dashboard whose entire job is rendering hostile input.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
