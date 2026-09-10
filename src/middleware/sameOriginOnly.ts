import type { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for state-changing dashboard routes.
 *
 * Cross-origin form POSTs are NOT blocked by CORS. Without this, any page the user has
 * open could auto-submit `_method=DELETE` to this server and wipe every captured request.
 * Binding to loopback does NOT prevent this - the request originates from the user's own
 * browser, which can reach 127.0.0.1.
 *
 * Sec-Fetch-Site is set by every modern browser and cannot be forged by page script.
 * Non-browser callers (curl, CI, scripts) never send it, so an ABSENT header is treated
 * as a non-browser caller and allowed - this keeps the spec 10 DELETE endpoints usable
 * from the command line.
 *   same-origin -> our own dashboard forms
 *   none        -> user typed the URL or used a bookmark
 *   same-site / cross-site -> another site drove this request: reject
 */
export function sameOriginOnly(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const site = req.get('sec-fetch-site');
  if (site === undefined || site === 'same-origin' || site === 'none') {
    next();
    return;
  }

  console.warn(`[csrf] rejected ${req.method} ${req.path} (sec-fetch-site: ${site})`);
  res.status(403).json({ status: 'FORBIDDEN', reason: 'cross-origin request rejected' });
}
