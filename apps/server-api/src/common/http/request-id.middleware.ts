import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';

import type { RequestWithContext } from './request-context';

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header('x-request-id');
  const requestId =
    supplied && VALID_REQUEST_ID.test(supplied) ? supplied : ulid();

  (request as RequestWithContext).requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}
