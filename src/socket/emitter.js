// src/socket/emitter.js
// Centralized socket emission utility for all namespaces

/**
 * Emit an event to a room in the /event namespace (event chat)
 */
// where emitEventChat is defined
export function emitEventChat(io, room, event, data) {
  const nsp = io.of('/event');
  const clients = nsp.adapter.rooms.get(room);
  const count = clients ? clients.size : 0;
  nsp.to(room).emit(event, data);
}

/**
 * Emit an event to a room in the /chat namespace (social chat)
 */
export function emitSocialChat(io, room, event, data) {
  io.of('/chat').to(room).emit(event, data);
}

/**
 * Emit an event to a room in the /chat namespace (group chat).
 * Shares the namespace with social chat — group chat rooms are joined via
 * `group:join` (see socket/groupChat.js), and inbox upserts for group chats
 * already ride the same namespace's `user:${userId}` rooms via
 * emitSocialChat, so this has to land in the same place.
 */
export function emitGroupChat(io, room, event, data) {
  io.of('/chat').to(room).emit(event, data);
}

/**
 * Emit an event to a user in the /notification namespace
 */
export function emitNotification(io, userId, event, data) {
  io.of('/notification').to(userId).emit(event, data);
}

/**
 * Broadcast a livestream change to all clients in the /livestream namespace
 */
export function emitLivestreamUpdate(io, event, data) {
  io.of('/livestream').emit(event, data);
}