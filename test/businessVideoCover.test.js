import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { parseFfmpegDuration, probeDurationSeconds } from '../src/utils/mediaDuration.js';
import { isVideoCoverLive } from '../src/services/businessVideoCover.service.js';

describe('video cover duration check', () => {
  it('reads the duration line ffmpeg prints', () => {
    expect(parseFfmpegDuration('  Duration: 00:00:29.97, start: 0.000000, bitrate: 900 kb/s')).toBeCloseTo(29.97);
    expect(parseFfmpegDuration('Duration: 01:02:03.50')).toBeCloseTo(3723.5);
    expect(parseFfmpegDuration('Duration: N/A, bitrate: N/A')).toBeNull();
    expect(parseFfmpegDuration('')).toBeNull();
  });

  it('measures a real video file', async () => {
    const file = path.join(os.tmpdir(), `video-cover-test-${process.pid}.mp4`);
    const made = spawnSync(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=160x120:rate=10',
      '-pix_fmt', 'yuv420p', file,
    ]);
    expect(made.status).toBe(0);
    try {
      expect(await probeDurationSeconds(file)).toBeCloseTo(3, 0);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }, 30_000);

  it('gives null for something that is not media', async () => {
    expect(await probeDurationSeconds(path.join(os.tmpdir(), 'does-not-exist.mp4'))).toBeNull();
  });
});

describe('video cover subscription', () => {
  it('is on only while the paid time runs', () => {
    expect(isVideoCoverLive({ videoCoverUntil: new Date(Date.now() + 60_000) })).toBe(true);
    expect(isVideoCoverLive({ videoCoverUntil: new Date(Date.now() - 1) })).toBe(false);
    expect(isVideoCoverLive({ videoCoverUntil: null })).toBe(false);
    expect(isVideoCoverLive(null)).toBe(false);
  });
});
