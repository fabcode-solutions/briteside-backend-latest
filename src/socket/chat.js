// src/socket/chat.js
// (Optional) Extracted chat event handlers for maintainability

function registerChatHandlers(socket) {
  socket.on('join', room => {
    if (!room) return; // Ignore invalid room
    socket.join(room);
    socket.emit('joined', { room });
  });

  socket.on('message', data => {
    socket.to(data.room).emit('message', data);
  });

  // Add more chat events as needed
}
export default registerChatHandlers;
