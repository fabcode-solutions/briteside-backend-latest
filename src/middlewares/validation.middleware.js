import { z } from 'zod';
import ApiError from '../utils/api-error.js';

export const validateRequest = schema => {
  return (req, res, next) => {
    try {
      const validationResult = schema.safeParse(req.body);
      if (!validationResult.success) {
        throw new ApiError(400, 'Validation error', validationResult.error.issues);
      }
      req.body = validationResult.data;
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Event validation schemas
export const createEventSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  categoryId: z.string().min(1, 'Category is required'),
  venueId: z.string().min(1, 'Venue is required'),
  eventType: z.enum(['public', 'private']),
  isFree: z.boolean(),
  eventStatus: z.enum(['draft', 'published']).default('draft'),
  maxAttendees: z.number().positive().optional(),
  imageUrl: z.string().url().optional(),
  tickets: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.number().min(0),
        totalQuantity: z.number().positive(),
        availableQuantity: z.number().positive(),
      })
    )
    .optional(),
  merchandise: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.number().min(0),
        totalQuantity: z.number().positive(),
        availableQuantity: z.number().positive(),
        imageUrl: z.string().url().optional(),
      })
    )
    .optional(),
});

export const updateEventSchema = createEventSchema.partial();

// Venue validation schema
export const createVenueSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  country: z.string().min(1, 'Country is required'),
  zipCode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  capacity: z.number().positive().optional(),
  description: z.string().optional(),
  amenities: z.array(z.string()).optional(),
  imageUrl: z.string().url().optional(),
});

// Ticket purchase validation schema
export const purchaseTicketsSchema = z.object({
  purchases: z.array(
    z.object({
      eventId: z.string().min(1),
      ticketId: z.string().min(1),
      quantity: z.number().positive(),
    })
  ),
  holderInfo: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
});

// Organizer validation schemas
export const createOrganizerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  logoUrl: z.string().url().optional(),
});

export const createMemberSchema = z.object({
  organizerId: z.string().min(1),
  memberData: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    role: z.enum(['admin', 'staff', 'volunteer']).default('staff'),
    permissions: z.array(z.string()).optional(),
  }),
});
