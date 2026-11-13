import express from 'express';

import { getOnboarding, saveOnboarding } from '../controllers/onboarding.controller.js';

// App setup flow — event + group category interests. Mounted behind
// authMiddleware; also backs Settings → Interests.
const router = express.Router();

router.get('/', getOnboarding);
router.put('/', saveOnboarding);

export default router;
