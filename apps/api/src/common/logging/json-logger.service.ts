import { LoggerService } from "@nestjs/common";

/**
 * One JSON object per line instead of Nest's default colored/human-oriented
 * format - log aggregators (Render's log stream, Datadog, etc.) can parse
 * this directly instead of regex-scraping ANSI-colored text. Wired in only
 * for production (see main.ts); local dev keeps Nest's readable default.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("log", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("verbose", message, optionalParams);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const entry: Record<string, unknown> = {
      level,
      timestamp: new Date().toISOString(),
      ...describeMessage(message),
    };

    // Nest's LoggerService methods are variadic and ambiguous by design
    // (log(msg, context) vs error(msg, stack, context)) - rather than guess
    // which positional string means what, the single-string-param case (by
    // far the most common call in this codebase) is labeled "context"; two
    // or more params are kept verbatim so nothing is silently mislabeled.
    if (optionalParams.length === 1 && typeof optionalParams[0] === "string") {
      entry.context = optionalParams[0];
    } else if (optionalParams.length > 0) {
      entry.details = optionalParams;
    }

    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

function describeMessage(message: unknown): { message: string } {
  if (message instanceof Error) {
    return { message: message.message };
  }
  if (typeof message === "string") {
    return { message };
  }
  try {
    return { message: JSON.stringify(message) };
  } catch {
    return { message: String(message) };
  }
}
