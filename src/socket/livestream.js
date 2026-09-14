import { LivestreamService } from '../services/livestream.service.js';

export default function registerLivestreamHandlers(socket) {
  LivestreamService.getActiveLivestreams({ page: 1, limit: 20 })
    .then(streams => socket.emit('livestream:active', { streams }))
    .catch(err => console.error('[socket/livestream] initial emit failed:', err));
}
