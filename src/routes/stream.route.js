import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  createCall,
  updateCallStatus,
  logCallEvent,
  initiateCall,
  generateToken,
  getCallById,
  generateGuestToken,
} from '../controllers/stream.controller.js';

const router = express.Router();

// Public — guest token for demo call participants (no account required)
router.post('/guest-token', generateGuestToken);

router.use(authMiddleware);

// Generate Stream token for user
router.get('/generateToken', generateToken);

router.get('/getCallByID/:cid', getCallById);

// Initiate a new call with Stream SDK
router.post('/calls/initiate', initiateCall);

// Create a new call
router.post('/calls/create', createCall);

// Update call status
router.put('/calls/:id/status', updateCallStatus);

// Log call events
router.post('/calls/:id/events', logCallEvent);

export default router;
