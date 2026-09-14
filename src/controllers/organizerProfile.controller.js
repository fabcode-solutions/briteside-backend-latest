import { OrganizerProfileService } from '../services/organizerProfile.service.js';
import ApiError from '../utils/api-error.js';

export class OrganizerProfileController {
  /**
   * Get public organizer profile
   */
  static async getPublicProfile(req, res, next) {
    try {
      const { organizerId } = req.params;

      if (!organizerId) {
        throw new ApiError(400, 'Organizer ID is required');
      }

      const profile = await OrganizerProfileService.getPublicProfile(organizerId);

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organizer events
   */
  static async getOrganizerEvents(req, res, next) {
    try {
      const { organizerId } = req.params;
      const { page = 1, limit = 12, status, timeFilter = 'all', search } = req.query;

      if (!organizerId) {
        throw new ApiError(400, 'Organizer ID is required');
      }

      const events = await OrganizerProfileService.getOrganizerEvents(organizerId, {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        timeFilter,
        search,
      });

      res.status(200).json({
        success: true,
        data: events,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organizer reviews
   */
  static async getOrganizerReviews(req, res, next) {
    try {
      const { organizerId } = req.params;
      const { page = 1, limit = 10, rating } = req.query;

      if (!organizerId) {
        throw new ApiError(400, 'Organizer ID is required');
      }

      const reviews = await OrganizerProfileService.getOrganizerReviews(organizerId, {
        page: parseInt(page),
        limit: parseInt(limit),
        rating: rating ? parseInt(rating) : undefined,
      });

      res.status(200).json({
        success: true,
        data: reviews,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create organizer member (protected - only organizer)
   */
  static async createMember(req, res, next) {
    try {
      const { organizerId } = req.params;
      const { memberName, memberPassword, role } = req.body;

      // Verify organizer ownership
      if (req.user.organizerId !== organizerId) {
        throw new ApiError(403, 'Unauthorized to manage this organizer');
      }

      if (!memberName || !memberPassword) {
        throw new ApiError(400, 'Member name and password are required');
      }

      if (memberPassword.length < 6) {
        throw new ApiError(400, 'Password must be at least 6 characters');
      }

      const member = await OrganizerProfileService.createMember(organizerId, {
        memberName,
        memberPassword,
        role,
      });

      res.status(201).json({
        success: true,
        data: member,
        message: 'Member created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organizer members (protected - only organizer)
   */
  static async getMembers(req, res, next) {
    try {
      const { organizerId } = req.params;
      const { page = 1, limit = 10, isActive } = req.query;

      // Verify organizer ownership
      if (req.user.organizerId !== organizerId) {
        throw new ApiError(403, 'Unauthorized to manage this organizer');
      }

      const members = await OrganizerProfileService.getMembers(organizerId, {
        page: parseInt(page),
        limit: parseInt(limit),
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      });

      res.status(200).json({
        success: true,
        data: members,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update member status (protected - only organizer)
   */
  static async updateMemberStatus(req, res, next) {
    try {
      const { organizerId, memberId } = req.params;
      const { isActive } = req.body;

      // Verify organizer ownership
      if (req.user.organizerId !== organizerId) {
        throw new ApiError(403, 'Unauthorized to manage this organizer');
      }

      if (typeof isActive !== 'boolean') {
        throw new ApiError(400, 'isActive must be a boolean value');
      }

      const member = await OrganizerProfileService.updateMemberStatus(
        organizerId,
        memberId,
        isActive
      );

      res.status(200).json({
        success: true,
        data: member,
        message: `Member ${isActive ? 'activated' : 'deactivated'} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Regenerate member password (protected - only organizer)
   */
  static async regeneratePassword(req, res, next) {
    try {
      const { organizerId, memberId } = req.params;
      const { newPassword } = req.body;

      // Verify organizer ownership
      if (req.user.organizerId !== organizerId) {
        throw new ApiError(403, 'Unauthorized to manage this organizer');
      }

      // Validate password if provided
      if (newPassword && newPassword.length < 6) {
        throw new ApiError(400, 'Password must be at least 6 characters');
      }

      const result = await OrganizerProfileService.regeneratePassword(
        organizerId,
        memberId,
        newPassword
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Password regenerated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete organizer member (protected - only organizer)
   */
  static async deleteMember(req, res, next) {
    try {
      const { organizerId, memberId } = req.params;

      // Verify organizer ownership
      if (req.user.organizerId !== organizerId) {
        throw new ApiError(403, 'Unauthorized to manage this organizer');
      }

      await OrganizerProfileService.deleteMember(organizerId, memberId);

      res.status(200).json({
        success: true,
        message: 'Member deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}
