import { Server } from 'socket.io';
import registerChatHandlers from './chat.js';
import registerEventChatHandlers from './event.js';
import registerGroupChatHandlers from './groupChat.js'; // ← add
import registerNotificationHandlers from './notification.js';
import registerLivestreamHandlers from './livestream.js';
import * as userService from '../services/user.service.js';

const onlineUsers = new Set();
const reconnectTimers = new Map();

// ← export this so other modules can check online status
export function isUserOnline(userId) {
  return onlineUsers.has(userId);
}

export default function setupSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const chatNamespace = io.of('/chat');
  chatNamespace.on('connection', async socket => {
    const userId = socket.handshake.auth?.userId;

    registerChatHandlers(socket);
    registerGroupChatHandlers(socket); // ← add — shares this namespace with direct messages

    if (userId) {
      if (reconnectTimers.has(userId)) {
        clearTimeout(reconnectTimers.get(userId));
        reconnectTimers.delete(userId);
      }

      socket.join(userId);
      socket.join(`user:${userId}`);
      onlineUsers.add(userId);

      const user = await userService.getUserById(userId).catch(() => null);
      if (user?.showOnlineStatus !== false) {
        chatNamespace.emit('user:online', { userId });
      }
    }

    socket.on('user:status', async ({ userId: targetId }) => {
      if (!onlineUsers.has(targetId)) {
        socket.emit('user:status:result', { userId: targetId, isOnline: false });
        return;
      }
      const targetUser = await userService.getUserById(targetId).catch(() => null);
      socket.emit('user:status:result', {
        userId: targetId,
        isOnline: targetUser?.showOnlineStatus !== false,
      });
    });

    socket.on('disconnect', async () => {
      if (!userId) return;

      const timer = setTimeout(async () => {
        reconnectTimers.delete(userId);
        onlineUsers.delete(userId);

        const lastSeen = new Date();
        await userService
          .updateUserById(userId, { lastSeen })
          .catch(err => console.error('[socket] lastSeen update failed:', err));

        const user = await userService.getUserById(userId).catch(() => null);
        if (user?.showOnlineStatus !== false) {
          chatNamespace.emit('user:offline', { userId, lastSeen: lastSeen.toISOString() });
        }
      }, 1000);

      reconnectTimers.set(userId, timer);
    });
  });

  io.of('/event').on('connection', socket => {
    registerEventChatHandlers(socket);
  });

  io.of('/notification').on('connection', socket => {
    registerNotificationHandlers(socket);
  });

  io.of('/livestream').on('connection', socket => {
    registerLivestreamHandlers(socket);
  });

  return io;
}