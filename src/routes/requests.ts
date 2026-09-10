import { Router, urlencoded } from 'express';
import methodOverride from 'method-override';
import * as controller from '../controllers/requestsController.ts';
import { sameOriginOnly } from '../middleware/sameOriginOnly.ts';

const router = Router();

// All three are scoped to dashboard routes only - none may touch /listen.
// The listener MUST keep accepting cross-origin requests: that is the product.
router.use(urlencoded({ extended: false }));

/**
 * Read the override from the BODY, not the query string.
 *
 * methodOverride('_method') - the string form - inspects `req.query`, so it only works
 * for URLs like /requests?_method=DELETE. Our forms use a hidden input, matching
 * Laravel's @method('DELETE'), which puts _method in the body. The function form is
 * required for that, and it must run after urlencoded has populated req.body.
 */
router.use(
  methodOverride((req) => {
    const body: unknown = req.body;
    if (body !== null && typeof body === 'object' && '_method' in body) {
      const record = body as Record<string, unknown>;
      const method = record._method;
      delete record._method;
      if (typeof method === 'string') return method;
    }
    // The type definition requires a string, so fall back to the current method:
    // overriding a request to what it already is is a no-op.
    return req.method;
  }),
);

router.use(sameOriginOnly); // CSRF guard, AFTER methodOverride so req.method is effective

router.get('/requests', controller.index);
router.get('/requests/:id', controller.show);
router.get('/requests/:id/body', controller.rawBody);
router.delete('/requests/:id', controller.destroy);
router.delete('/requests', controller.destroyAll);

export default router;
