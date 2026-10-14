import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import ffmpegPath from 'ffmpeg-static';
import { extractAudio } from '../src/services/copyrightScan.service.js';

// Generates small real fixture videos with ffmpeg itself (no network, no
// fixture binaries checked into the repo) so extraction runs against actual
// decodable media, the same as a real upload.
function generateFixture(filePath, { withAudio }) {
  const args = ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=3'];
  if (withAudio) {
    args.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:a', 'aac');
  }
  args.push('-c:v', 'libx264', filePath);
  execFileSync(ffmpegPath, args, { stdio: 'ignore' });
}

describe('extractAudio', () => {
  const musicVideoPath = path.join(os.tmpdir(), `acr-test-music-${randomUUID()}.mp4`);
  const silentVideoPath = path.join(os.tmpdir(), `acr-test-silent-${randomUUID()}.mp4`);

  beforeAll(() => {
    generateFixture(musicVideoPath, { withAudio: true });
    generateFixture(silentVideoPath, { withAudio: false });
  });

  afterAll(async () => {
    await fs.unlink(musicVideoPath).catch(() => {});
    await fs.unlink(silentVideoPath).catch(() => {});
  });

  it('extracts a non-empty, valid WAV sample from a video that has an audio track', async () => {
    const buffer = await extractAudio(musicVideoPath);
    expect(buffer.length).toBeGreaterThan(0);
    // RIFF/WAVE header — confirms it's a well-formed WAV, not just arbitrary bytes.
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buffer.subarray(8, 12).toString('ascii')).toBe('WAVE');
  }, 15000);

  it('returns an empty buffer for a video with no audio track at all (silent upload)', async () => {
    const buffer = await extractAudio(silentVideoPath);
    expect(buffer.length).toBe(0);
  }, 15000);
});
