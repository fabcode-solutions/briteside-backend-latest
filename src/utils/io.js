import app from '../app.js';

export function getIO() {
  return app.get && app.get('io');
}
