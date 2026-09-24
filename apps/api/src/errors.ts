export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(message = "Resource not found") {
  return new AppError(404, "NOT_FOUND", message);
}

export function forbidden(message = "Permission denied") {
  return new AppError(403, "FORBIDDEN", message);
}

export function conflict(message = "Resource conflict") {
  return new AppError(409, "CONFLICT", message);
}
