import { notificationService } from '../services/index.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { z } from 'zod';

const updateNotificationSchema = z.object({
  isRead: z.boolean().optional(),
});

const updateSettingsSchema = z.object({
  eventUpdates: z.boolean().optional(),
  purchaseConfirmation: z.boolean().optional(),
  eventReminders: z.boolean().optional(),
  chatMessages: z.boolean().optional(),
  groupActivities: z.boolean().optional(),
  socialUpdates: z.boolean().optional(),
  birthdayNotifications: z.boolean().optional(),
});

export const getNotifications = catchAsync(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, 'User ID is required');
  }

  const notifications = await notificationService.getNotificationsByUserId(userId);

  res.json({
    success: true,
    data: notifications,
  });
});
export const markAsRead = catchAsync(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, 'User ID is required');
  }

  const notifications = await notificationService.markAsRead(userId);

  res.json({
    success: true,
    data: notifications,
  });
});

export const createNotification = catchAsync(async (req, res) => {
  const { userId, title, message, type, redirectTo, relatedId, metadata } = req.body;

  if (!userId || !title || !message || !type) {
    throw new ApiError(400, 'User ID, title, message, and type are required');
  }

  const notificationData = {
    userId,
    title,
    message,
    type,
    redirectTo,
    relatedId,
  };
  if (metadata !== undefined) notificationData.metadata = metadata;

  const newNotification = await notificationService.createNotification(notificationData, req);

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: newNotification,
  });
});

export const updateNotification = catchAsync(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    throw new ApiError(400, 'Notification ID is required');
  }

  const validatedData = updateNotificationSchema.parse(req.body);

  if (Object.keys(validatedData).length === 0) {
    throw new ApiError(400, 'No valid fields provided for update');
  }

  const updatedNotification = await notificationService.updateNotificationById(id, validatedData);

  if (!updatedNotification) {
    throw new ApiError(404, 'Notification not found');
  }

  res.json({
    success: true,
    message: 'Notification updated successfully',
    data: updatedNotification,
  });
});

export const deleteNotification = catchAsync(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    throw new ApiError(400, 'Notification ID is required');
  }

  const deletedNotification = await notificationService.deleteNotificationById(id);

  if (!deletedNotification) {
    throw new ApiError(404, 'Notification not found');
  }

  res.json({
    success: true,
    message: 'Notification deleted successfully',
  });
});

export const getNotificationSettings = catchAsync(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, 'User ID is required');
  }

  let settings = await notificationService.getNotificationSettingsByUserId(userId);

  if (!settings) {
    // Create default settings if not found
    settings = await notificationService.createOrUpdateNotificationSettings(userId, {
      eventUpdates: true,
      purchaseConfirmation: true,
      eventReminders: true,
      chatMessages: true,
      groupActivities: true,
      birthdayNotifications: true,
    });
  }

  res.json({
    success: true,
    data: settings,
  });
});

export const updateNotificationSettings = catchAsync(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, 'User ID is required');
  }

  const validatedData = updateSettingsSchema.parse(req.body);

  if (Object.keys(validatedData).length === 0) {
    throw new ApiError(400, 'No valid fields provided for update');
  }

  const updatedSettings = await notificationService.createOrUpdateNotificationSettings(
    userId,
    validatedData
  );

  res.json({
    success: true,
    message: 'Notification settings updated successfully',
    data: updatedSettings,
  });
});
