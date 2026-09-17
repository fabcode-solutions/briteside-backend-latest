import { Router } from 'express';

import { userController, userDeviceController } from '../controllers/index.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User
 */
const userRoutes = Router();

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get a user
 *     description: Logged in users can fetch only their own user information.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *                $ref: '#/components/schemas/User'
 *       "404":
 *         $ref: '#/components/responses/NotFound'
 */
userRoutes
  .route('/profile')
  .get(userController.getUserProfile)
  .put(authMiddleware, userController.updateUserProfile);

// UserInformation endpoints: fetch and upsert user information
userRoutes
  .route('/information')
  .get(authMiddleware, userController.getUserInformation)
  .put(authMiddleware, userController.upsertUserInformation);

// Registered push-notification devices — call on login/app-open (register)
// and on logout (deactivate).
userRoutes
  .route('/devices')
  .post(authMiddleware, userDeviceController.registerDevice)
  .delete(authMiddleware, userDeviceController.deactivateDevice);

export { userRoutes };
