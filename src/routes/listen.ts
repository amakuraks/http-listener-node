import { Router, raw } from 'express';
import { config } from '../config.ts';
import { capture } from '../controllers/listenController.ts';

const router = Router();

/**
 * VERIFIED: spec 12.2's '/listen/*' THROWS on Express 5
 *   "Missing parameter name at index 9: /listen/*"
 * path-to-regexp v8 removed unnamed wildcards. The braces make the trailing segment
 * optional, so this single route matches /listen and /listen/a/b/c alike.
 *
 * express.raw is mounted HERE, not globally - a global body parser would consume the
 * stream and defeat raw capture on this route.
 */
router.all('/listen{/*splat}', raw({ type: '*/*', limit: config.maxBodySize }), capture);

export default router;
