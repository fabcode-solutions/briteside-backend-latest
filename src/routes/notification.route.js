import express from 'express';
import {
  getNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
  getNotificationSettings,
  updateNotificationSettings,
  markAsRead,
} from '../controllers/notification.controller.js';

const router = express.Router();

// Get all notifications for a user
router.get('/:userId', getNotifications);

router.patch('/:userId/markAsRead', markAsRead);
// Create a new notification
router.post('/', createNotification);

// Update a notification (mark as read/unread)
router.patch('/:id', updateNotification);

// Delete a notification
router.delete('/:id', deleteNotification);

// notification settings routes

router.get('/settings/:userId', getNotificationSettings);
router.put('/settings/:userId', updateNotificationSettings);

export default router;
