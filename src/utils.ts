export function pickId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const uid = (value as { uid?: unknown }).uid;
    if (typeof uid === "string" || typeof uid === "number") {
      return String(uid);
    }
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" || typeof id === "number") {
      return String(id);
    }
  }
  return "";
}

export function maybeParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
