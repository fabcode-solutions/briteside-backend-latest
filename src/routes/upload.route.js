import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { uploadFile, deleteFile, getUserFiles } from '../controllers/upload.controller.js';
import { bulkInviteFromCsv } from '../controllers/bulkMail.controller.js';
import { bulkInviteLimiter } from '../middlewares/rateLimiter.js';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 50MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    const { mimetype, originalname } = file;
    // Broad categories
    const isImage = mimetype.startsWith('image/');
    // Only mp4/mov — the formats Stream moderation can analyze (video/quicktime = .mov)
    const isVideo = mimetype === 'video/mp4' || mimetype === 'video/quicktime';
    const isUnsupportedVideo = mimetype.startsWith('video/') && !isVideo;
    const isAudio = mimetype.startsWith('audio/');

    // Specific document/archive types
    const allowedMimes = new Set([
      'application/pdf',
      // ZIP variations
      'application/zip',
      'application/x-zip-compressed',
      'application/x-msdownload', // added for .rar files
      // Excel variations
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/csv', // csv (often uploaded as spreadsheets)
    ]);

    // Extension-based fallback for when browsers send generic types
    const allowedExtensions = new Set([
      '.pdf',
      '.zip',
      '.rar',
      '.xls',
      '.xlsx',
      '.csv',
      // common audio extensions
      '.mp3',
      '.wav',
      '.ogg',
      '.oga',
      '.m4a',
      '.aac',
      '.flac',
      '.webm',
      '.opus',
    ]);

    const lowerName = (originalname || '').toLowerCase();
    const hasAllowedExt = Array.from(allowedExtensions).some(ext => lowerName.endsWith(ext));

    if (isUnsupportedVideo) {
      return cb(new Error('Only MP4 and MOV videos are supported'), false);
    }

    if (isImage || isVideo || isAudio || allowedMimes.has(mimetype) || hasAllowedExt) {
      return cb(null, true);
    }

    return cb(
      new Error('Only images, videos, audio, PDF, ZIP, and Excel files are allowed'),
      false
    );
  },
});

// Multer error handler middleware
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return next(
          new ApiError(httpStatus.BAD_REQUEST, 'File size too large. Maximum size is 50MB')
        );
      case 'LIMIT_FILE_COUNT':
        return next(
          new ApiError(httpStatus.BAD_REQUEST, 'Too many files. Maximum 10 files allowed')
        );
      case 'LIMIT_UNEXPECTED_FILE':
        return next(new ApiError(httpStatus.BAD_REQUEST, 'Unexpected file field'));
      default:
        return next(new ApiError(httpStatus.BAD_REQUEST, `Upload error: ${error.message}`));
    }
  }

  // Handle boundary and other multipart errors
  if (error.message && error.message.includes('Boundary not found')) {
    return next(
      new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid multipart request. Please ensure Content-Type is set correctly'
      )
    );
  }

  if (error.message && error.message.includes('Only images, videos, audio')) {
    return next(new ApiError(httpStatus.BAD_REQUEST, error.message));
  }

  next(error);
};

// Protected routes
router.use(authMiddleware);
router.get('/my-files', getUserFiles);
router.post('/', upload.single('file'), handleMulterError, uploadFile);
router.post('/multiple', upload.array('files', 10), handleMulterError, uploadFile);
router.delete('/:fileId', deleteFile);

// Bulk invite: upload CSV of emails → send templated SES emails to all recipients
// Body: { type: "event"|"group", entityId: "<uuid>" }  Field: file (CSV)
router.post(
  '/bulk-invite',
  bulkInviteLimiter,
  upload.single('file'),
  handleMulterError,
  bulkInviteFromCsv
);

export default router;
