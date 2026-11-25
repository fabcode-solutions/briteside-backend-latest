/**
 * "Send inquiry" on a business page. Customers always write it on Briteside, so
 * it goes through the same moderation and contact-info rules as any inquiry.
 * It lands in the owner's Inquiry inbox; when the business chose 'email'
 * (Edit profile → Contact) it's also emailed to their inquiry address
 * (see businessInquiryEmail.service.js) — neither side sees the other's address.
 *
 * This only opens the conversation with the owner (so the owner's id stays
 * private). The message itself goes through the normal chat endpoint with
 * messageType 'inquiry', which moderates it and notifies the owner live.
 */
import httpStatus from 'http-status';
import ApiError from '../utils/api-error.js';
import { loadPublicBusiness } from './businessWall.service.js';
import { SocialChatService } from './socialChat.service.js';

export class BusinessInquiryService {
  static async openConversation(user, idOrSlug) {
    const business = await loadPublicBusiness(idOrSlug);
    if (business.ownerId === user.id) {
      throw new ApiError(httpStatus.BAD_REQUEST, "You can't send an inquiry to your own business");
    }
    const conversation = await SocialChatService.getOrCreateConversation(user.id, business.ownerId);
    return { conversationId: conversation.id };
  }
}
