import { UploadService } from '../services/upload.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
import logger from '../config/logger.js';

// Validate folder parameter
const validateFolder = folder => {
  const allowedFolders = ['general', 'events', 'users', 'groups', 'tickets', 'social', 'talents'];
  const folderPattern = new RegExp(`^(${allowedFolders.join('|')})(/.+)?$`);

  if (!folderPattern.test(folder)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid folder. Must start with one of: ${allowedFolders.join(', ')}`
    );
  }
};

// Validate file properties
const validateFile = file => {
  if (!file.originalname || !file.mimetype || !file.buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid file data');
  }

  if (file.size === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Empty file not allowed');
  }
};

export const uploadFile = catchAsync(async (req, res) => {
  try {
    // Extract files from request
    const files = req.files || (req.file ? [req.file] : []);

    // Validate files exist
    if (files.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No files uploaded');
    }

    // Extract and validate parameters
    const { folder = 'general', entityId } = req.body;
    validateFolder(folder);

    // Validate each file
    files.forEach((file, index) => {
      try {
        validateFile(file);
      } catch (error) {
        throw new ApiError(httpStatus.BAD_REQUEST, `File ${index + 1}: ${error.message}`);
      }
    });

    logger.info(`Upload request: ${files.length} file(s) to folder '${folder}'`, {
      userId: req.user?.id,
      entityId,
      fileNames: files.map(f => f.originalname),
      fileSizes: files.map(f => f.size),
    });

    if (files.length === 1) {
      // Single file upload
      const result = await UploadService.uploadFile(files[0], folder, entityId, req.user?.id);

      logger.info('Single file upload successful', {
        userId: req.user?.id,
        fileName: files[0].originalname,
        url: result.url,
        isDuplicate: result.isDuplicate,
      });

      res.json({
        success: true,
        message: result.isDuplicate
          ? 'File already exists, returned existing URL'
          : 'File uploaded successfully',
        data: result,
      });
    } else {
      // Multiple files upload with error handling
      const results = [];
      const errors = [];

      for (let i = 0; i < files.length; i++) {
        try {
          const result = await UploadService.uploadFile(files[i], folder, entityId, req.user?.id);
          results.push(result);
        } catch (error) {
          logger.error(`Failed to upload file ${files[i].originalname}:`, error);
          errors.push({
            fileName: files[i].originalname,
            error: error.message,
          });
        }
      }

      if (errors.length > 0 && results.length === 0) {
        // All uploads failed
        throw new ApiError(
          httpStatus.INTERNAL_SERVER_ERROR,
          'All file uploads failed',
          true,
          null,
          { errors }
        );
      }

      logger.info(
        `Multiple file upload completed: ${results.length} successful, ${errors.length} failed`,
        {
          userId: req.user?.id,
          successful: results.map(r => r.originalName),
          failed: errors.map(e => e.fileName),
        }
      );

      res.json({
        success: true,
        message: `${results.length} of ${files.length} files uploaded successfully`,
        data: results,
        ...(errors.length > 0 && { errors }),
      });
    }
  } catch (error) {
    logger.error('Upload controller error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      body: req.body,
      fileCount: req.files?.length || (req.file ? 1 : 0),
    });
    throw error;
  }
});
export const deleteFile = catchAsync(async (req, res) => {
  const { fileId } = req.params;
  const userId = req.user.id;
  const permanent = req.query?.permanent === 'true' || req.body?.permanent === true;

  const result = await UploadService.deleteFile(fileId, userId, { permanent });

  res.json({
    success: true,
    message:
      result.message || (permanent ? 'File permanently deleted' : 'File deleted successfully'),
  });
});

export const getUserFiles = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { mediaType, folder, limit, offset } = req.query;

  // Validate mediaType if provided
  const validMediaTypes = ['image', 'video', 'audio', 'document'];
  if (mediaType && !validMediaTypes.includes(mediaType)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid mediaType. Must be one of: ${validMediaTypes.join(', ')}`
    );
  }
  const options = {
    mediaType,
    folder,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  };

  // Validate pagination params
  if (options.limit < 1 || options.limit > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Limit must be between 1 and 100');
  }

  if (options.offset < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Offset must be non-negative');
  }

  const result = await UploadService.getUserFiles(userId, options);

  res.json({
    success: true,
    message: 'Files retrieved successfully',
    data: result,
  });
});
