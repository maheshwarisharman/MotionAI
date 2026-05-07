/**
 * Winston logger — single shared instance used across the entire application.
 * Log level defaults to "info" in production, "debug" in development.
 */

import winston from 'winston';
import { env } from '../config/env.js';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

/** Human-friendly format for local development */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  simple(),
);

/** Structured JSON format for production log aggregation */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  /** Never crash the process on uncaught logger exceptions */
  exitOnError: false,
});
