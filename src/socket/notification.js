// src/socket/notification.js
// Notification namespace event handlers

function registerNotificationHandlers(socket) {
  // Example: Listen for a client to join their user room for targeted notifications
  socket.on('join', userId => {
    if (userId) {
      socket.join(String(userId));
      socket.emit('joined', { userId: String(userId) });
    }
  });

  // You can add more handlers as needed, e.g., for marking notifications as read, etc.
}

export default registerNotificationHandlers;
