import { format, transports, createLogger } from 'winston';
import 'winston-daily-rotate-file';

const { combine, json, colorize, simple } = format;

const authLogger = createLogger({
  level: 'warn',
  format: json(),
  defaultMeta: { service: 'auth' },
  transports: [
    new transports.DailyRotateFile({
      filename: 'logs/authlogs-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
    }),
    new transports.File({
      filename: 'logs/authlogs-error.log',
      level: 'error',
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  authLogger.add(
    new transports.Console({
      format: combine(colorize(), simple()),
    })
  );
}

export default authLogger;
