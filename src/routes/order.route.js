import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import {
  eventAccessMiddleware,
  requireEventPermission,
  teamMemberAuthMiddleware,
} from '../middlewares/eventAccess.middleware.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';
import {
  getEventsOrders,
  getUserOrders,
  getUserOrder,
  updateOrder,
  cancelOrder,
} from '../controllers/order.controller.js';

const router = express.Router();

// Event orders route: organizer/admin/team member with orders.view permission
router.get(
  '/events/:eventId',
  optionalAuthMiddleware,
  teamMemberAuthMiddleware,
  eventAccessMiddleware,
  requireEventPermission(PERMISSIONS.ORDERS_VIEW),
  getEventsOrders
);

// All order routes require authentication
router.use(authMiddleware);

// Get all orders for current user (with filters, pagination, sorting)
router.get('/', getUserOrders);
// Get a specific order by ID
router.get('/:orderId', getUserOrder);

// Update an order
router.patch('/:orderId', updateOrder);

// Cancel an order
router.post('/:orderId/cancel', cancelOrder);

export default router;
