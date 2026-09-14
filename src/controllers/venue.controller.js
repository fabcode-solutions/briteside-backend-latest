import { VenueService } from '../services/venue.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const createVenue = catchAsync(async (req, res) => {
  const venue = await VenueService.createVenue(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: 'Venue created successfully',
    data: { venue },
  });
});

export const getVenues = catchAsync(async (req, res) => {
  const venues = await VenueService.getVenues();

  res.json({
    success: true,
    data: { venues },
  });
});
export const getVenuesLocations = catchAsync(async (req, res) => {
  const { country, state, city } = req.query;
  const userId = req.user?.id;
  const venuesLocations = await VenueService.getVenuesLocations({ country, state, city, userId });

  res.json({
    success: true,
    data: { venuesLocations },
  });
});

export const getVenueById = catchAsync(async (req, res) => {
  const venue = await VenueService.getVenueById(req.params.venueId);

  if (!venue) {
    throw new ApiError(404, 'Venue not found');
  }

  res.json({
    success: true,
    data: { venue },
  });
});

export const searchVenues = catchAsync(async (req, res) => {
  const { query } = req.query;
  const venues = await VenueService.searchVenues(query);

  res.json({
    success: true,
    data: { venues },
  });
});

export const updateVenue = catchAsync(async (req, res) => {
  const { venueId } = req.params;
  const userId = req.user.id;

  const updated = await VenueService.updateVenue(venueId, userId, req.body);

  res.json({
    success: true,
    message: 'Venue updated successfully',
    data: { venue: updated },
  });
});

export const adminListVenues = catchAsync(async (req, res) => {
  const venues = await VenueService.getVenues();
  res.json({ success: true, data: { venues } });
});

export const adminGetVenue = catchAsync(async (req, res) => {
  const venue = await VenueService.getVenueById(req.params.venueId);
  if (!venue) throw new ApiError(404, 'Venue not found');
  res.json({ success: true, data: { venue } });
});
