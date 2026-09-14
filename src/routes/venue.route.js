import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  createVenue,
  getVenues,
  getVenueById,
  searchVenues,
  getVenuesLocations,
  updateVenue,
} from '../controllers/venue.controller.js';

const router = express.Router();

// Public routes
router.get('/', getVenues);
router.get('/search', searchVenues);
router.get('/venues-locations', getVenuesLocations);
router.get('/:venueId', getVenueById);

// Protected routes
router.use(authMiddleware);
router.post('/', createVenue);
router.patch('/:venueId', updateVenue);

export default router;
