// src/socket/event.js
// (Optional) Extracted event chat event handlers for maintainability

function registerEventChatHandlers(socket) {
  socket.on('join', eventId => {
    socket.join(eventId);
    socket.emit('joined', eventId);
  });

  socket.on('eventMessage', data => {
    socket.to(data.eventId).emit('eventMessage', data);
  });

  // Add more event chat events as needed
}
export default registerEventChatHandlers;
