export const EXIT_CODES = Object.freeze({
  success: 0,
  internal: 1,
  invalidUsage: 2,
  invalidInput: 3,
  unavailable: 4,
  limitExceeded: 5,
  processingFailed: 6,
  resourceBusy: 7,
  cancelled: 130,
});

export class EpistemeError extends Error {
  constructor(message, {
    code = "INTERNAL_ERROR",
    exitCode = EXIT_CODES.internal,
    retryable = false,
    details = null,
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "EpistemeError";
    this.code = code;
    this.exitCode = exitCode;
    this.retryable = retryable;
    this.details = details;
  }
}

export function usageError(message, details = null) {
  return new EpistemeError(message, {
    code: "INVALID_USAGE",
    exitCode: EXIT_CODES.invalidUsage,
    details,
  });
}

export function inputError(message, details = null, cause) {
  return new EpistemeError(message, {
    code: "INVALID_INPUT",
    exitCode: EXIT_CODES.invalidInput,
    details,
    cause,
  });
}

export function unavailableError(message, details = null, cause) {
  return new EpistemeError(message, {
    code: "SOURCE_UNAVAILABLE",
    exitCode: EXIT_CODES.unavailable,
    retryable: true,
    details,
    cause,
  });
}

export function limitError(message, details = null) {
  return new EpistemeError(message, {
    code: "LIMIT_EXCEEDED",
    exitCode: EXIT_CODES.limitExceeded,
    details,
  });
}

export function processingError(message, details = null, cause) {
  return new EpistemeError(message, {
    code: "PROCESSING_FAILED",
    exitCode: EXIT_CODES.processingFailed,
    details,
    cause,
  });
}

export function resourceBusyError(message, details = null, cause) {
  return new EpistemeError(message, {
    code: "RESOURCE_BUSY",
    exitCode: EXIT_CODES.resourceBusy,
    retryable: true,
    details,
    cause,
  });
}

export function cancelledError(signalName = "SIGINT") {
  return new EpistemeError(`Operation cancelled by ${signalName}`, {
    code: "CANCELLED",
    exitCode: signalName === "SIGTERM" ? 143 : EXIT_CODES.cancelled,
    details: { signal: signalName },
  });
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const signalName = typeof signal.reason === "string" ? signal.reason : "SIGINT";
    throw cancelledError(signalName);
  }
}

export function normalizeError(error) {
  if (error instanceof EpistemeError) {
    return error;
  }
  return new EpistemeError(error instanceof Error ? error.message : String(error), {
    cause: error instanceof Error ? error : undefined,
  });
}
