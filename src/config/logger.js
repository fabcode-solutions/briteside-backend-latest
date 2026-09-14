import { format, transports, createLogger } from 'winston';
import 'winston-daily-rotate-file';

const { combine, json, colorize, simple } = format;

const fileRotateTransport = new transports.DailyRotateFile({
  filename: 'logs/combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
});

const logger = createLogger({
  level: 'silly',
  format: json(),
  transports: [
    fileRotateTransport,
    new transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: combine(colorize(), simple()),
    })
  );
}

// Dedicated cron logger — all cron output goes here, errors get their own file.
export const cronLogger = createLogger({
  level: 'silly',
  format: json(),
  transports: [
    new transports.DailyRotateFile({
      filename: 'logs/cron-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '20d',
    }),
    new transports.DailyRotateFile({
      filename: 'logs/cron-errors-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      level: 'error',
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  cronLogger.add(
    new transports.Console({
      format: combine(colorize(), simple()),
    })
  );
}

export default logger;
