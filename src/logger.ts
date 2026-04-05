import {
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  warn as tauriWarn,
} from "@tauri-apps/plugin-log";

type LogContext = Record<string, unknown>;

let debugLoggingEnabled = false;

export function setFrontendDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled;
}

export function logInfo(message: string, context?: LogContext): void {
  emitLog("info", message, context);
}

export function logWarn(message: string, context?: LogContext): void {
  emitLog("warn", message, context);
}

export function logError(message: string, err?: unknown, context?: LogContext): void {
  const mergedContext: LogContext = {
    ...(context ?? {}),
    ...(err === undefined ? {} : { error: formatError(err) }),
  };

  emitLog("error", message, mergedContext);
}

export function logDebug(message: string, context?: LogContext): void {
  if (!debugLoggingEnabled) {
    return;
  }
  emitLog("debug", message, context);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

function formatMessage(message: string, context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) {
    return message;
  }

  return `${message} | ${JSON.stringify(context)}`;
}

function emitLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: LogContext,
): void {
  const payload = formatMessage(message, context);

  const writePromise =
    level === "debug"
      ? tauriDebug(payload)
      : level === "info"
        ? tauriInfo(payload)
        : level === "warn"
          ? tauriWarn(payload)
          : tauriError(payload);

  void writePromise.catch(() => {
    if (level === "error") {
      console.error(payload);
      return;
    }

    if (level === "warn") {
      console.warn(payload);
      return;
    }

    if (level === "info") {
      console.info(payload);
      return;
    }

    console.debug(payload);
  });
}
