import { logDebug, logWarn, redactString } from "../shared/logging.js";
import { asPlainObject, pickId } from "../shared/utils.js";

const SESSION_LOG_BODY_PREVIEW_MAX = 280;
const SESSION_LOG_RAW_SNIPPET_KEYS_MAX = 12;
const SESSION_LOG_DEDUPE_TTL_MS = 30_000;
const GLOBAL_SESSION_LOGGER_INSTALLED = "__clawchatSessionLoggerInstalled";

type SessionLogPhase = "session_open" | "new_message";
type SessionLogDirection = "inbound" | "outbound" | "internal";
type SessionLogRole = "user" | "assistant" | "system" | "tool" | "unknown";
type SessionLogSource = "console" | "unknown" | `channel:${string}`;

type SessionLogEvent = {
  sessionKey: string;
  phase: SessionLogPhase;
  direction: SessionLogDirection;
  source: SessionLogSource;
  channelId?: string;
  messageId?: string;
  role: SessionLogRole;
  timestamp?: number;
  history: boolean;
  bodyPreview: string;
  rawSnippet?: Record<string, unknown>;
};

const recentSessionLogKeys = new Map<string, number>();
const seenSessionKeys = new Set<string>();
const sessionEventCountByPhase = new Map<string, number>();
const sessionEventCountBySource = new Map<string, number>();
const sessionEventCountByRole = new Map<string, number>();
const recentSessionEvents: SessionLogEvent[] = [];

function cleanupSessionLogCaches(now = Date.now()): void {
  for (const [key, ts] of recentSessionLogKeys.entries()) {
    if (now - ts > SESSION_LOG_DEDUPE_TTL_MS) {
      recentSessionLogKeys.delete(key);
    }
  }
}

function dedupeSessionLog(key: string): boolean {
  const now = Date.now();
  cleanupSessionLogCaches(now);
  if (recentSessionLogKeys.has(key)) {
    return false;
  }
  recentSessionLogKeys.set(key, now);
  return true;
}

function normalizeMetadataWrappedText(value: string): string {
  let normalized = value;
  normalized = normalized.replace(
    /(?:Conversation info|Sender) \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi,
    "",
  );
  normalized = normalized.replace(/^\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}[^\]]*\]\s*/g, "");
  return normalized.trim();
}

function limitSessionBodyPreview(value: string): string {
  const normalized = redactString(normalizeMetadataWrappedText(value).replace(/\s+/g, " ").trim());
  if (!normalized) {
    return "";
  }
  return normalized.length > SESSION_LOG_BODY_PREVIEW_MAX
    ? `${normalized.slice(0, SESSION_LOG_BODY_PREVIEW_MAX)}...`
    : normalized;
}

function normalizeSessionTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const parsedDate = Date.parse(trimmed);
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }
  return undefined;
}

function toSessionLogSource(value: unknown): SessionLogSource {
  const text = String(value ?? "").trim();
  if (!text) {
    return "unknown";
  }
  if (text === "console") {
    return "console";
  }
  return `channel:${text}`;
}

function normalizeSessionLogRole(value: unknown, fallback?: unknown): SessionLogRole {
  const candidates = [value, fallback].map((item) => String(item ?? "").trim().toLowerCase());
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (candidate === "user" || candidate === "human") {
      return "user";
    }
    if (candidate === "assistant" || candidate === "ai" || candidate === "bot") {
      return "assistant";
    }
    if (candidate === "system") {
      return "system";
    }
    if (candidate === "tool" || candidate === "function") {
      return "tool";
    }
  }
  return "unknown";
}

function summarizeLogValue(value: unknown, depth: number): unknown {
  if (depth >= 3) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }
    if (value && typeof value === "object") {
      return "[Object]";
    }
    return value;
  }
  if (typeof value === "string") {
    return limitSessionBodyPreview(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 6).map((item) => summarizeLogValue(item, depth + 1));
  }
  const obj = asPlainObject(value);
  if (!obj) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).slice(0, 12)) {
    const nested = obj[key];
    if (typeof nested === "function") {
      continue;
    }
    out[key] = summarizeLogValue(nested, depth + 1);
  }
  return out;
}

function extractBodyPreviewFromStructuredContent(value: unknown): string {
  if (typeof value === "string") {
    return limitSessionBodyPreview(value);
  }
  if (Array.isArray(value)) {
    return limitSessionBodyPreview(
      value
        .map((item) => extractBodyPreviewFromStructuredContent(item))
        .filter(Boolean)
        .join(" "),
    );
  }
  const obj = asPlainObject(value);
  if (!obj) {
    return "";
  }
  const structuredCandidates: unknown[] = [
    obj.text,
    obj.value,
    obj.content,
    obj.input_text,
    obj.output_text,
    obj.title,
    obj.name,
    obj.label,
  ];
  for (const candidate of structuredCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return limitSessionBodyPreview(candidate);
    }
  }
  if (typeof obj.type === "string" && obj.type.trim()) {
    const nested = [
      extractBodyPreviewFromStructuredContent(obj.text),
      extractBodyPreviewFromStructuredContent(obj.content),
      extractBodyPreviewFromStructuredContent(obj.value),
    ]
      .filter(Boolean)
      .join(" ");
    return limitSessionBodyPreview(nested ? `${obj.type}: ${nested}` : obj.type);
  }
  return "";
}

function extractBodyPreviewFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return limitSessionBodyPreview(value);
  }
  if (Array.isArray(value)) {
    return limitSessionBodyPreview(
      value
        .map((item) => extractBodyPreviewFromUnknown(item))
        .filter(Boolean)
        .join(" "),
    );
  }
  const obj = asPlainObject(value);
  if (!obj) {
    return "";
  }
  const candidates: unknown[] = [
    obj.Body,
    obj.body,
    obj.BodyForAgent,
    obj.BodyForCommands,
    obj.CommandBody,
    obj.text,
    obj.content,
    obj.message,
    obj.output,
    obj.output_text,
    obj.response,
    obj.answer,
    obj.prompt,
    obj.input,
    obj.value,
    obj.summary,
    obj.title,
    obj.content,
    (obj.payload as Record<string, unknown> | undefined)?.text,
    (obj.payload as Record<string, unknown> | undefined)?.content,
    obj.message,
    (obj.message as Record<string, unknown> | undefined)?.text,
    (obj.message as Record<string, unknown> | undefined)?.content,
    obj.data,
    (obj.data as Record<string, unknown> | undefined)?.text,
    (obj.data as Record<string, unknown> | undefined)?.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return limitSessionBodyPreview(candidate);
    }
    const nestedPreview = extractBodyPreviewFromStructuredContent(candidate);
    if (nestedPreview) {
      return nestedPreview;
    }
  }
  return "";
}

function summarizeTranscriptMessage(value: unknown): Record<string, unknown> | null {
  const obj = asPlainObject(value);
  if (!obj) {
    const preview = extractBodyPreviewFromUnknown(value);
    return preview ? { messagePreview: preview } : null;
  }
  const summary: Record<string, unknown> = {};
  const role = typeof obj.role === "string" ? obj.role : undefined;
  const preview = extractBodyPreviewFromUnknown(value);
  const timestamp = normalizeSessionTimestamp(obj.timestamp ?? obj.createdAt ?? obj.updatedAt);
  const responseId = pickId(obj.responseId);
  const stopReason = typeof obj.stopReason === "string" ? obj.stopReason : undefined;
  const provider = typeof obj.provider === "string" ? obj.provider : undefined;
  const model = typeof obj.model === "string" ? obj.model : undefined;

  if (role) {
    summary.messageRole = role;
  }
  if (preview) {
    summary.messagePreview = preview;
  }
  if (timestamp) {
    summary.messageTimestamp = timestamp;
  }
  if (responseId) {
    summary.responseId = responseId;
  }
  if (stopReason) {
    summary.stopReason = stopReason;
  }
  if (provider) {
    summary.provider = provider;
  }
  if (model) {
    summary.model = model;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function buildSessionLogRawSnippet(value: unknown): Record<string, unknown> | undefined {
  const obj = asPlainObject(value);
  if (!obj) {
    return undefined;
  }
  const rawSnippet: Record<string, unknown> = {};
  for (const key of Object.keys(obj).slice(0, SESSION_LOG_RAW_SNIPPET_KEYS_MAX)) {
    const nested = obj[key];
    if (typeof nested === "function") {
      continue;
    }
    if (key === "message") {
      const messageSummary = summarizeTranscriptMessage(nested);
      if (messageSummary) {
        Object.assign(rawSnippet, messageSummary);
      }
      continue;
    }
    rawSnippet[key] = summarizeLogValue(nested, 0);
  }
  return Object.keys(rawSnippet).length > 0 ? rawSnippet : undefined;
}

function extractSessionKeyFromUnknown(value: unknown): string {
  const obj = asPlainObject(value);
  if (!obj) {
    return "";
  }
  const directCandidates = [
    obj.sessionKey,
    obj.SessionKey,
    obj.session_key,
    obj.sid,
    obj.sessionId,
    obj.session_id,
    obj.conversationId,
    obj.conversation_id,
    obj.threadId,
    obj.thread_id,
    obj.key,
    obj.name,
    obj.id,
    (obj.ctx as Record<string, unknown> | undefined)?.SessionKey,
    (obj.session as Record<string, unknown> | undefined)?.sessionKey,
    (obj.session as Record<string, unknown> | undefined)?.id,
    (obj.session as Record<string, unknown> | undefined)?.key,
  ];
  for (const candidate of directCandidates) {
    const id = pickId(candidate);
    if (id && (id.includes(":") || id.length > 0)) {
      return id;
    }
  }
  return "";
}

function normalizeOpenClawSessionLogEvent(params: {
  phase: SessionLogPhase;
  direction: SessionLogDirection;
  source?: unknown;
  channelId?: unknown;
  history?: boolean;
  sessionKey?: unknown;
  messageId?: unknown;
  role?: unknown;
  timestamp?: unknown;
  body?: unknown;
  raw?: unknown;
}): SessionLogEvent | null {
  const rawObj = asPlainObject(params.raw);
  const sessionKey =
    pickId(params.sessionKey) ||
    (rawObj ? extractSessionKeyFromUnknown(rawObj) : "") ||
    extractSessionKeyFromUnknown(params.body);
  if (!sessionKey) {
    return null;
  }
  const messageId =
    pickId(params.messageId) ||
    (rawObj
      ? pickId(rawObj.messageId ?? rawObj.message_id ?? rawObj.id ?? rawObj.mid)
      : "") ||
    undefined;
  const event: SessionLogEvent = {
    sessionKey,
    phase: params.phase,
    direction: params.direction,
    source: toSessionLogSource(params.source ?? params.channelId),
    channelId: pickId(params.channelId) || undefined,
    messageId,
    role: normalizeSessionLogRole(
      params.role,
      rawObj ? rawObj.role ?? rawObj.authorRole ?? rawObj.author_role ?? rawObj.kind : undefined,
    ),
    timestamp:
      normalizeSessionTimestamp(params.timestamp) ||
      (rawObj
        ? normalizeSessionTimestamp(
            rawObj.timestamp ??
              rawObj.createdAt ??
              rawObj.created_at ??
              rawObj.updatedAt ??
              rawObj.ts ??
              rawObj.at,
          )
        : undefined),
    history: params.history === true,
    bodyPreview: extractBodyPreviewFromUnknown(params.body ?? params.raw),
    rawSnippet: buildSessionLogRawSnippet(rawObj ?? params.raw),
  };
  return event;
}

function logSessionEvent(event: SessionLogEvent): void {
  const dedupeKey = [
    event.phase,
    event.direction,
    event.sessionKey,
    event.messageId ?? "",
    event.history ? "history" : "live",
    event.bodyPreview,
  ].join("|");
  if (!dedupeSessionLog(dedupeKey)) {
    return;
  }
  sessionEventCountByPhase.set(event.phase, (sessionEventCountByPhase.get(event.phase) ?? 0) + 1);
  sessionEventCountBySource.set(event.source, (sessionEventCountBySource.get(event.source) ?? 0) + 1);
  sessionEventCountByRole.set(event.role, (sessionEventCountByRole.get(event.role) ?? 0) + 1);
  recentSessionEvents.push(event);
  if (recentSessionEvents.length > 20) {
    recentSessionEvents.shift();
  }
  const summary = [
    `phase=${event.phase}`,
    `direction=${event.direction}`,
    `session=${event.sessionKey}`,
    `source=${event.source}`,
    event.channelId ? `channelId=${event.channelId}` : "",
    event.messageId ? `messageId=${event.messageId}` : "",
    `role=${event.role}`,
    event.history ? "history=true" : "history=false",
    event.timestamp ? `timestamp=${event.timestamp}` : "",
    event.bodyPreview ? `body="${event.bodyPreview}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  logDebug(`session log ${summary}`, event.rawSnippet);
}

function formatCountMap(map: Map<string, number>): string {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function formatRecentSessionEvents(): string[] {
  if (recentSessionEvents.length === 0) {
    return ["recent events: none"];
  }
  return recentSessionEvents.slice(-10).map((event) => {
    const eventTimestamp =
      normalizeSessionTimestamp(event.timestamp) ??
      normalizeSessionTimestamp(event.rawSnippet?.timestamp) ??
      Date.now();
    const parts = [
      new Date(eventTimestamp).toISOString(),
      event.phase,
      event.direction,
      `session=${event.sessionKey}`,
      `source=${event.source}`,
      `role=${event.role}`,
      event.bodyPreview ? `body="${event.bodyPreview}"` : "",
    ].filter(Boolean);
    return parts.join(" | ");
  });
}

export function formatGlobalOpenClawSessionLoggerStatus(): string {
  const lines = [
    "ClawChat runtime session logger status",
    `tracked sessions: ${seenSessionKeys.size}`,
    `phase counts: ${formatCountMap(sessionEventCountByPhase)}`,
    `source counts: ${formatCountMap(sessionEventCountBySource)}`,
    `role counts: ${formatCountMap(sessionEventCountByRole)}`,
    ...formatRecentSessionEvents(),
  ];
  return lines.join("\n");
}

export function resetGlobalOpenClawSessionLoggerStatus(): string {
  recentSessionLogKeys.clear();
  seenSessionKeys.clear();
  sessionEventCountByPhase.clear();
  sessionEventCountBySource.clear();
  sessionEventCountByRole.clear();
  recentSessionEvents.length = 0;
  return "ClawChat runtime session logger status reset.";
}

function logSessionOpen(sessionKey: string, raw?: unknown, source?: unknown, channelId?: unknown): void {
  if (!sessionKey || seenSessionKeys.has(sessionKey)) {
    return;
  }
  seenSessionKeys.add(sessionKey);
  const event = normalizeOpenClawSessionLogEvent({
    phase: "session_open",
    direction: "internal",
    source,
    channelId,
    sessionKey,
    raw,
  });
  if (event) {
    logSessionEvent(event);
  }
}

function logSessionMessage(params: {
  phase: "new_message";
  direction: SessionLogDirection;
  source?: unknown;
  channelId?: unknown;
  history?: boolean;
  sessionKey?: unknown;
  messageId?: unknown;
  role?: unknown;
  timestamp?: unknown;
  body?: unknown;
  raw?: unknown;
}): void {
  const event = normalizeOpenClawSessionLogEvent(params);
  if (!event) {
    return;
  }
  logSessionOpen(event.sessionKey, params.raw, params.source, params.channelId);
  logSessionEvent(event);
}

function inferTranscriptMessageRole(message: unknown): SessionLogRole {
  const obj = asPlainObject(message);
  if (!obj) {
    return "unknown";
  }
  return normalizeSessionLogRole(
    obj.role ?? obj.authorRole ?? obj.author_role ?? obj.kind,
    (obj.ai as Record<string, unknown> | undefined)?.role,
  );
}

function shouldSkipWrappedTranscriptMessage(params: {
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
}): boolean {
  const sessionKey = pickId(params.sessionKey);
  if (!sessionKey.startsWith("agent:main:clawchat-router:")) {
    return false;
  }
  if (!pickId(params.messageId)) {
    return false;
  }
  const message = params.message;
  const role = inferTranscriptMessageRole(message);
  if (role !== "user") {
    return false;
  }
  const preview = extractBodyPreviewFromUnknown(message);
  if (!preview) {
    return false;
  }
  return (
    preview.includes("Sender (untrusted metadata):") &&
    preview.includes("openclaw-control-ui")
  );
}

function buildTranscriptEventKey(update: {
  sessionFile: string;
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
}): string {
  const sessionKey = pickId(update.sessionKey) || update.sessionFile || "";
  const message = asPlainObject(update.message);
  const timestamp = normalizeSessionTimestamp(message?.timestamp) ?? 0;
  const role = inferTranscriptMessageRole(update.message);
  const bodyPreview = extractBodyPreviewFromUnknown(update.message);
  return [
    "transcript",
    sessionKey,
    update.messageId ?? "",
    role,
    String(timestamp),
    bodyPreview,
  ].join("|");
}

export function installGlobalOpenClawSessionLogger(runtime: unknown): void {
  const runtimeObj = asPlainObject(runtime);
  if (!runtimeObj) {
    logWarn("global session logger skipped: runtime is not an object");
    return;
  }
  if ((runtimeObj as Record<string, unknown>)[GLOBAL_SESSION_LOGGER_INSTALLED]) {
    logDebug("global session logger already installed");
    return;
  }
  (runtimeObj as Record<string, unknown>)[GLOBAL_SESSION_LOGGER_INSTALLED] = true;

  const events = asPlainObject(runtimeObj.events);
  const eventSubscriptions: string[] = [];
  if (events && typeof events.onSessionTranscriptUpdate === "function") {
    (
      events.onSessionTranscriptUpdate as (
        listener: (update: {
          sessionFile: string;
          sessionKey?: string;
          message?: unknown;
          messageId?: string;
        }) => void,
      ) => () => void
    )((update) => {
      if (!dedupeSessionLog(`runtime-event|transcript|${buildTranscriptEventKey(update)}`)) {
        return;
      }
      if (
        shouldSkipWrappedTranscriptMessage({
          sessionKey: update.sessionKey,
          message: update.message,
          messageId: update.messageId,
        })
      ) {
        return;
      }
      const sessionKey = pickId(update.sessionKey);
      if (!sessionKey) {
        logDebug("session transcript update missing sessionKey", {
          sessionFile: update.sessionFile,
          messageId: update.messageId,
        });
        return;
      }
      logSessionOpen(sessionKey, update, "runtime.events");
      logSessionMessage({
        phase: "new_message",
        direction: "inbound",
        source: "runtime.events",
        sessionKey,
        messageId: update.messageId,
        role: inferTranscriptMessageRole(update.message),
        timestamp:
          asPlainObject(update.message)?.timestamp ?? asPlainObject(update.message)?.createdAt,
        body: update.message,
        raw: update,
      });
    });
    eventSubscriptions.push("runtime.events.onSessionTranscriptUpdate");
  }
  logDebug("global session logger installed", {
    mode: "transcript-open-message-only",
    eventSubscriptions,
    lifecycleCoverage: {
      sessionOpen: true,
      sessionClose: false,
      message: true,
    },
  });
}
