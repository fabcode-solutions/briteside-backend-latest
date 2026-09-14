// src/socket/groupChat.js
//
// Group chat event handlers. Registered on the same `/chat` namespace as
// direct messages (not a separate namespace like event chat's `/event`),
// because `emitGroupChat` needs to reach the same namespace where
// `user:${userId}` rooms already live for inbox upserts (see
// GroupChatController#sendGroupMessage's emitSocialChat call).
//
// ASSUMPTION: this presumes `emitGroupChat(io, chatRoomId, event, data)` in
// `socket/emitter.js` does something like
// `io.of('/chat').to(chatRoomId).emit(event, data)`. If it actually opens a
// dedicated `/group` namespace instead (mirroring how `/event` is wired for
// event chat), move the `on('connection', ...)` registration below out of
// `chatNamespace` and into its own `io.of('/group')` block in index.js.

function registerGroupChatHandlers(socket) {
  // Client calls socket.emit('group:join', groupChatRoomId) once it opens a
  // group chat, so chat:new_message / chat:message_updated / chat:read /
  // chat:reaction_added / chat:reaction_removed broadcasts reach it.
  socket.on('group:join', chatRoomId => {
    if (!chatRoomId) return;
    socket.join(chatRoomId);
    socket.emit('group:joined', chatRoomId);
  });

  socket.on('group:leave', chatRoomId => {
    if (!chatRoomId) return;
    socket.leave(chatRoomId);
  });

  // Typing indicator relay — optional, but cheap to include alongside join/leave
  // since group chat has no other realtime signal for this yet.
  socket.on('group:typing', ({ chatRoomId, userId, isTyping }) => {
    if (!chatRoomId) return;
    socket.to(chatRoomId).emit('group:typing', { chatRoomId, userId, isTyping });
  });
}

export default registerGroupChatHandlers;
