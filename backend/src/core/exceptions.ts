/** Base application error. Safe `message` is shown to the client. */
export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
  }
}

export class SemanticResolutionError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class SQLGenerationError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class SQLValidationError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class SQLExecutionError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}

export class DataSourceError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}

export class SemanticModelError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

/** Raised when the LLM provider itself fails to fulfill a request - e.g. a
 * prompt that no longer fits the model's loaded context window. */
export class LLMError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}
