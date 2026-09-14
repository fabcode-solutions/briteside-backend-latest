import httpStatus from 'http-status';

import APIError from '../utils/api-error.js';
import env from '../config/config.js';
import logger from '../config/logger.js';
import ApiError from '../utils/api-error.js';

const isProduction = () => env.nodeEnv === 'production';

/**
 * Coerce whatever an error carries into a status code res.status() will accept.
 * Anything missing, non-integer or out of the 4xx-5xx range becomes a 500.
 */
const normalizeStatus = value =>
  Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : httpStatus.INTERNAL_SERVER_ERROR;

/**
 * Error handler. Send stacktrace only during local
 * @public
 */
export const handler = (err, req, res, next) => {
  const statusCode = normalizeStatus(err?.statusCode);

  // internal failure details must never reach the client in production

const message = err?.message || httpStatus[statusCode];

const response = {
  success: false,
  error: {
    code: statusCode,
    message,
    stack: err?.stack,
    ...(err?.details && { details: err.details }),
  },
};

  logger.log(statusCode === httpStatus.NOT_FOUND ? 'silly' : 'error', 'Error handler error log:', {
    statusCode,
    message: err?.message,
    method: req.method,
    url: req.originalUrl,
    stack: err?.stack,
  });

  // response already started (streamed download, aborted upload) - let express close it
  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json(response);
};

/**
 * If error is not an instanceOf APIError, convert it.
 * @public
 */
export const converter = (error, req, res, next) => {
  // !NOTE: error instanceof PostgresError not working PostgresError is not exported from postgres package
  if (error?.constructor?.name === 'PostgresError') {
    if (error.routine === '_bt_check_unique') {
      const [key, value] = (error.detail?.match(/\(([^)]+)\)/g) || []).map(x =>
        x.replace(/[()]/g, '')
      );
      const message =
        key && value
          ? `${key} ${value} already exists. Please try again using different value`
          : 'This value already exists. Please try again using different value';
      return next(new ApiError(httpStatus.BAD_REQUEST, message, true, error.stack));
    }
    const message = error.message || httpStatus[httpStatus.INTERNAL_SERVER_ERROR];
    return next(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, message, false, error.stack));
  }

  if (error?.name === 'ZodError') {
    const message = error.issues?.[0]?.message || 'Invalid input.';
    return next(new ApiError(httpStatus.BAD_REQUEST, message, true, error.stack));
  }

  if (!(error instanceof ApiError)) {
    // keep the status the error already carries (413 from body-parser, 402 from stripe, ...)
    const statusCode = normalizeStatus(error?.statusCode || error?.status);
    const message = error?.message || httpStatus[statusCode];
    return next(
      new ApiError(statusCode, message, statusCode < 500, error?.stack, error?.details ?? null)
    );
  }

  next(error);
};

/**
 * Catch 404 and forward to error handler
 * @public
 */
export const notFound = (req, res, next) => {
  const error = new APIError(httpStatus.NOT_FOUND, 'Not found');
  next(error);
};
