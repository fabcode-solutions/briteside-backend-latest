import { EventChatService } from '../services/eventChat.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Hard-deletes event chat rooms (messages, participants, reactions,
 * read receipts) for events that ended more than 48 hours ago.
 */
export const cleanupExpiredEventChats = async () => {
  const deletedRooms = await EventChatService.deleteExpiredEventChats();

  if (deletedRooms.length === 0) return;

  logger.info('[EventChatCleanup] Deleted expired event chat rooms', {
    count: deletedRooms.length,
    events: deletedRooms.map(r => r.eventTitle),
  });
};
