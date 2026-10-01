// src/socket/chat.js
// (Optional) Extracted chat event handlers for maintainability

function registerChatHandlers(socket) {
  socket.on('join', room => {
    if (!room) return; // Ignore invalid room
    socket.join(room);
    socket.emit('joined', { room });
  });

  // Without this, a socket stays in every conversation room it ever joined
  // until it disconnects — the frontend's leaveConversation() used to only
  // clear its own local tracking, never telling the server. That left
  // otherUserInConvo (socialChat.controller.js) permanently true for any
  // conversation a user had merely opened once, silently suppressing their
  // in-app "new message" notifications for it from then on.
  socket.on('leave', room => {
    if (!room) return;
    socket.leave(room);
  });

  socket.on('message', data => {
    socket.to(data.room).emit('message', data);
  });

  // Add more chat events as needed
}
export default registerChatHandlers;
