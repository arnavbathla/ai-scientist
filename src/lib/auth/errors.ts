/**
 * Pure HTTP error helpers — extracted so they can be imported in environments
 * (e.g. vitest, the worker) that don't pull in next-auth.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function unauthorized(): HttpError {
  return new HttpError(401, "unauthorized");
}

export function forbidden(): HttpError {
  return new HttpError(403, "forbidden");
}

export function notFound(): HttpError {
  return new HttpError(404, "not_found");
}

export function badRequest(message = "bad_request"): HttpError {
  return new HttpError(400, message);
}
