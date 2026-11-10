import express from 'express';

import { startSession, getStatus } from '../controllers/ageVerification.controller.js';

// Mounted behind authMiddleware; these paths are exempt from the age gate
// (see AGE_VERIFICATION_EXEMPT_PATHS) so an unverified user can verify.
const router = express.Router();

router.post('/session', startSession);
router.get('/status', getStatus);

export default router;
