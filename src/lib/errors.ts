import { Request, Response, NextFunction } from 'express';
import logger from './logger';

/**
 * Application error codes for structured API responses.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  NOT_FOUND = 'NOT_FOUND',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  MPESA_ERROR = 'MPESA_ERROR',
  CARD_ERROR = 'CARD_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Global error handler middleware — catches all thrown/next(err) errors.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.warn({ code: err.code, path: req.path, statusCode: err.statusCode }, err.message);
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Unexpected errors
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({
    error: ErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred. Please try again later.',
  });
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    error: ErrorCode.NOT_FOUND,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
