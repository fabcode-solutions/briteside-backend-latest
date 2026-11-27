/**
 * Reads a video's duration (seconds) with the bundled ffmpeg (ffmpeg-static —
 * there's no ffprobe binary). `ffmpeg -i <url>` with no output exits with an
 * error but prints the container's "Duration: HH:MM:SS.xx" line first; that's
 * all this needs, and ffmpeg only reads the header to print it.
 */
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/** "Duration: 00:00:29.97" → 29.97; null when the text has none (or N/A). */
export function parseFfmpegDuration(text) {
  const m = DURATION_RE.exec(String(text ?? ''));
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Duration of the media at `url` in seconds, or null if it can't be read. */
export function probeDurationSeconds(url, { timeoutMs = 20_000 } = {}) {
  return new Promise(resolve => {
    let stderr = '';
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(parseFfmpegDuration(stderr));
    }, timeoutMs);
    child.stderr.on('data', chunk => {
      stderr += chunk;
      // Enough read once the duration line is in
      const seconds = parseFfmpegDuration(stderr);
      if (seconds != null) {
        child.kill('SIGKILL');
        finish(seconds);
      }
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(parseFfmpegDuration(stderr)));
  });
}
