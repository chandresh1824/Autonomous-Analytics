import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  requestId: string;
  conversationId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(fn: () => T, initial: Partial<RequestContext> = {}): T {
  const parent = als.getStore();
  const context: RequestContext = {
    requestId: initial.requestId ?? parent?.requestId ?? "-",
    conversationId: initial.conversationId ?? parent?.conversationId ?? "-",
  };
  return als.run(context, fn);
}

export const requestIdVar = {
  get(): string {
    return als.getStore()?.requestId ?? "-";
  },
  set(value: string): void {
    const store = als.getStore();
    if (store) store.requestId = value;
  },
};

export const conversationIdVar = {
  get(): string {
    return als.getStore()?.conversationId ?? "-";
  },
  set(value: string): void {
    const store = als.getStore();
    if (store) store.conversationId = value;
  },
};

const SENSITIVE_KEYS = ["password", "api_key", "apikey", "secret", "token", "authorization"];
const LEVEL_ORDER: Record<string, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, CRITICAL: 50 };

function redact(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
      redacted[key] = "***";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redact(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export interface LogPayload {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  request_id: string;
  conversation_id: string;
  [key: string]: unknown;
}

function buildPayload(level: string, loggerName: string, message: string, extra?: Record<string, unknown>): LogPayload {
  const payload: LogPayload = {
    timestamp: new Date().toISOString(),
    level,
    logger: loggerName,
    message,
    request_id: requestIdVar.get(),
    conversation_id: conversationIdVar.get(),
  };
  if (extra) Object.assign(payload, redact(extra));
  return payload;
}

const MAX_BUFFER = 2000;
const buffer: LogPayload[] = [];
let minLevel = "INFO";

function emit(level: string, loggerName: string, message: string, extra?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const payload = buildPayload(level, loggerName, message, extra);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
  buffer.push(payload);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

export function configureLogging(level = "INFO"): void {
  minLevel = level.toUpperCase() in LEVEL_ORDER ? level.toUpperCase() : "INFO";
}

export function getRecentLogs(options: { limit?: number; level?: string; query?: string } = {}): LogPayload[] {
  const { limit = 200, level, query } = options;
  let entries = [...buffer];
  if (level) {
    const threshold = LEVEL_ORDER[level.toUpperCase()] ?? 0;
    entries = entries.filter((e) => (LEVEL_ORDER[e.level] ?? 0) >= threshold);
  }
  if (query) {
    const q = query.toLowerCase();
    entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  }
  entries.reverse();
  return entries.slice(0, limit);
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warning(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  exception(message: string, extra?: Record<string, unknown>): void;
}

export function getLogger(name: string): Logger {
  return {
    debug: (message, extra) => emit("DEBUG", name, message, extra),
    info: (message, extra) => emit("INFO", name, message, extra),
    warning: (message, extra) => emit("WARNING", name, message, extra),
    error: (message, extra) => emit("ERROR", name, message, extra),
    exception: (message, extra) => emit("ERROR", name, message, extra),
  };
}
