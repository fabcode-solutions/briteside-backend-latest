import crypto, { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { eq } from 'drizzle-orm';
import { getBoss } from '../lib/pgboss.js';
import { db } from '../db/index.js';
import { acrCopyrightScans } from '../db/schema/acrCopyrightScans.js';
import { CopyrightReviewCaseService } from './copyrightReviewCase.service.js';
import logger from '../config/logger.js';
import env from '../config/config.js';

ffmpeg.setFfmpegPath(ffmpegPath);

export const JOB_SCAN_COPYRIGHT_AUDIO = 'scan-copyright-audio';

const IDENTIFY_PATH = '/v1/identify';
const DATA_TYPE = 'audio';
// ACRCloud's identify API only reads the first ~12s of a sample — 15s of
// extracted audio comfortably covers that with room to spare.
const EXTRACT_SECONDS = 15;

const log = {
  info: (msg, meta = {}) => logger.info(msg, { module: 'copyright-scan', ...meta }),
  warn: (msg, meta = {}) => logger.warn(msg, { module: 'copyright-scan', ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: 'copyright-scan', ...meta }),
};

/**
 * ACRCloud Identification API v1 signature: Base64(HMAC-SHA1(accessSecret,
 * "POST\n/v1/identify\n{accessKey}\n{dataType}\n1\n{timestamp}")).
 * Pure function (no env/IO reads) so it can be unit-tested directly.
 */
export function buildSignature({ accessKey, accessSecret, dataType, timestamp }) {
  const stringToSign = ['POST', IDENTIFY_PATH, accessKey, dataType, '1', String(timestamp)].join(
    '\n'
  );
  return crypto.createHmac('sha1', accessSecret).update(stringToSign).digest('base64');
}

/**
 * Map an ACRCloud /v1/identify response to our status. code 0 = match found,
 * 1001 = no match (not an error) — anything else is a real API/account error.
 * Pure function so response-handling can be tested without network/DB.
 */
export function parseAcrResult(json) {
  const code = json?.status?.code;
  if (code === 0) {
    return { status: 'match', matches: json?.metadata?.music ?? [] };
  }
  if (code === 1001) {
    return { status: 'clean', matches: [] };
  }
  const msg = json?.status?.msg || 'ACRCloud error';
  return {
    status: 'error',
    matches: [],
    // Code is always appended so the stored/logged reason is specific even
    // when ACRCloud's msg text is generic (e.g. "Can't generate fingerprint"
    // is code 2004 — see https://docs.acrcloud.com/sdk-reference/error-codes).
    errorMessage: `${msg} (code ${code ?? 'unknown'})`,
  };
}

/**
 * Decides whether an ACRCloud result should open an admin review case.
 * Only a real match with at least one matched track qualifies — 'clean'
 * (no match found), 'no_audio', and 'error' never do. Pure function so this
 * rule can be unit-tested without touching the scan worker or DB.
 */
export function shouldCreateReviewCase(status, matches) {
  return status === 'match' && Array.isArray(matches) && matches.length > 0;
}

/**
 * Pipe ffmpeg's decoded output straight into memory instead of a second temp
 * file — opening that output file by path intermittently fails on Windows
 * (ffmpeg error "Error opening output file ... Invalid argument", exit -22),
 * confirmed against a real upload. The input still needs to be a real file
 * so ffmpeg can seek (the video's moov atom may be anywhere in the file).
 *
 * Output is uncompressed WAV/PCM, not MP3: lossy re-encoding is unnecessary
 * risk for a fingerprinting input, and an MP3 muxer normally seeks back to
 * patch its VBR header after encoding — a no-op on a non-seekable pipe. WAV
 * has no such requirement and removes any doubt about what ACRCloud receives
 * (its own "Can't generate fingerprint" / code 2004 gave no further detail).
 */
export function extractAudio(inputPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const command = ffmpeg(inputPath)
      .noVideo()
      .duration(EXTRACT_SECONDS)
      .audioChannels(1)
      .audioFrequency(44100)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', reject);
    const stream = command.pipe();
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Download the video and extract a short audio-only sample via ffmpeg.
 * ACRCloud's engine needs an actual decodable audio stream — submitting raw
 * muxed video container bytes fails with "Unable to generate fingerprint"
 * (ACRCloud error code 2004), confirmed against a real upload.
 */
async function getAudioSample(url) {
  const videoPath = path.join(os.tmpdir(), `acr-scan-${randomUUID()}.video`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download media: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(videoPath));
    return await extractAudio(videoPath);
  } finally {
    await fs.unlink(videoPath).catch(() => {});
  }
}

/** Upserts the scan row and returns its id (needed to link a review case). */
async function upsertScan({ mediaId, userId, status, matches = [], errorMessage = null }) {
  const changes = {
    status,
    matches,
    errorMessage,
    scannedAt: new Date(),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(acrCopyrightScans)
    .values({ mediaId, userId: userId ?? null, ...changes })
    .onConflictDoUpdate({ target: acrCopyrightScans.mediaId, set: changes })
    .returning({ id: acrCopyrightScans.id });
  return row?.id;
}

export class CopyrightScanService {
  /**
   * Queue an async copyright-audio scan for a freshly uploaded video.
   * Never throws — a failure here must not break the upload flow, mirroring
   * MediaModerationService.enqueue.
   */
  static async enqueue({ mediaId, userId, url }) {
    if (!mediaId || !url) return;
    try {
      const boss = getBoss();
      await boss.createQueue(JOB_SCAN_COPYRIGHT_AUDIO);
      await boss.send(
        JOB_SCAN_COPYRIGHT_AUDIO,
        { mediaId, userId, url },
        { retryLimit: 3, retryDelay: 30, retryBackoff: true }
      );
    } catch (error) {
      log.error('Failed to enqueue copyright scan job', { mediaId, error: error.message });
    }
  }

  /**
   * Worker entry: extract an audio sample from the video, submit it to
   * ACRCloud's Identification API, and record the verdict. Only ever writes
   * to acr_copyright_scans and (on a match) acr_copyright_review_cases —
   * never touches content_moderation, S3 ACLs, or moderation notifications.
   */
  static async runCheck({ mediaId, userId, url }) {
    const { host, accessKey, accessSecret } = env.acrcloud;

    if (!env.acrcloud.configured) {
      log.warn('ACRCloud credentials not configured — skipping copyright scan', { mediaId });
      await upsertScan({
        mediaId,
        userId,
        status: 'error',
        errorMessage: 'ACRCloud credentials not configured',
      });
      return;
    }

    try {
      const buffer = await getAudioSample(url);
      if (buffer.length === 0) {
        // Not a failure — ffmpeg resolves without an 'error' event even when
        // the source has no audio stream at all (silent/video-only upload),
        // so a zero-byte result is the only reliable signal for that case.
        // Nothing to check against ACRCloud, so skip the API call entirely.
        await upsertScan({ mediaId, userId, status: 'no_audio', matches: [] });
        log.info('Copyright scan skipped — no audio track', { mediaId });
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = buildSignature({ accessKey, accessSecret, dataType: DATA_TYPE, timestamp });

      const form = new FormData();
      form.append('sample', new Blob([buffer]), 'sample.wav');
      form.append('sample_bytes', String(buffer.length));
      form.append('access_key', accessKey);
      form.append('data_type', DATA_TYPE);
      form.append('signature_version', '1');
      form.append('signature', signature);
      form.append('timestamp', String(timestamp));

      const identifyRes = await fetch(`https://${host}${IDENTIFY_PATH}`, {
        method: 'POST',
        body: form,
      });
      const json = await identifyRes.json();
      const { status, matches, errorMessage } = parseAcrResult(json);

      const scanId = await upsertScan({ mediaId, userId, status, matches, errorMessage });
      if (status === 'error') {
        // ACRCloud's own msg/code are public response fields, never
        // credentials — safe to log in full for diagnosis.
        log.error('ACRCloud returned an error for this scan', { mediaId, errorMessage });
      } else {
        log.info('Copyright scan completed', { mediaId, status, matchCount: matches.length });
      }

      // A match never blocks/deletes the video — it only opens an admin
      // review case (see CopyrightReviewCaseService). 'clean'/'no_audio'/
      // 'error' never create one.
      if (shouldCreateReviewCase(status, matches)) {
        await CopyrightReviewCaseService.createIfNotExists({
          mediaId,
          scanId,
          userId,
          match: matches[0],
        });
      }
    } catch (error) {
      log.error('Copyright scan failed', { mediaId, error: error.message });
      await upsertScan({ mediaId, userId, status: 'error', errorMessage: error.message });
      // Rethrow so pg-boss retries (retryLimit set at enqueue).
      throw error;
    }
  }

  /** Current scan row for a media file, or null if never scanned. */
  static async statusOf(mediaId) {
    if (!mediaId) return null;
    return db.query.acrCopyrightScans.findFirst({ where: eq(acrCopyrightScans.mediaId, mediaId) });
  }
}

export default CopyrightScanService;
