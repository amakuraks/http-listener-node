import { Router, urlencoded } from 'express';
import methodOverride from 'method-override';
import * as controller from '../controllers/requestsController.ts';
import { sameOriginOnly } from '../middleware/sameOriginOnly.ts';

const router = Router();

// All three are scoped to dashboard routes only - none may touch /listen.
// The listener MUST keep accepting cross-origin requests: that is the product.
router.use(urlencoded({ extended: false }));
router.use(methodOverride('_method'));
router.use(sameOriginOnly); // CSRF guard, AFTER methodOverride so req.method is effective

router.get('/requests', controller.index);
router.get('/requests/:id', controller.show);
router.get('/requests/:id/body', controller.rawBody);
router.delete('/requests/:id', controller.destroy);
router.delete('/requests', controller.destroyAll);

export default router;
