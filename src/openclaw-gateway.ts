import { createHash } from "node:crypto";
import { getClawchatRuntime } from "./runtime.js";
import { logDebug, logWarn } from "./logging.js";
import { asPlainObject, maybeParseJson, stripAnsi } from "./utils.js";

export function isConfigChangedSinceLastLoadError(err: unknown): boolean {
  const text =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? `${err.message}\n${err.stack ?? ""}`
        : "";
  return /config changed since last load; re-run config\.get and retry/i.test(text);
}

export function parseJsonFromMixedText(text: string): unknown {
  const cleaned = stripAnsi(text).trim();
  if (!cleaned) {
    return null;
  }

  const direct = maybeParseJson(cleaned);
  if (direct !== null) {
    return direct;
  }

  const fencedMatches = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [];
  for (const block of fencedMatches) {
    const body = block.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const parsed = maybeParseJson(body);
    if (parsed !== null) {
      return parsed;
    }
  }

  const firstObj = cleaned.indexOf("{");
  const lastObj = cleaned.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    const parsed = maybeParseJson(cleaned.slice(firstObj, lastObj + 1));
    if (parsed !== null) {
      return parsed;
    }
  }

  const firstArr = cleaned.indexOf("[");
  const lastArr = cleaned.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    const parsed = maybeParseJson(cleaned.slice(firstArr, lastArr + 1));
    if (parsed !== null) {
      return parsed;
    }
  }

  for (const line of cleaned.split(/\r?\n/)) {
    const t = line.trim();
    const parsed = maybeParseJson(t);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

export async function runGatewayCall(command: string, params: Record<string, unknown>): Promise<unknown> {
  const runtime = getClawchatRuntime();
  const argv = ["openclaw", "gateway", "call", command, "--params", JSON.stringify(params)];
  logDebug("exec openclaw gateway call", {
    command,
    paramsKeys: Object.keys(params),
  });
  const result = await runtime.system.runCommandWithTimeout(argv, {
    timeoutMs: 30_000,
  });
  const resultObj = asPlainObject(result);
  const stdout =
    typeof resultObj?.stdout === "string"
      ? resultObj.stdout
      : typeof resultObj?.output === "string"
        ? resultObj.output
        : typeof result === "string"
          ? result
          : "";
  const stderr =
    typeof resultObj?.stderr === "string"
      ? resultObj.stderr
      : typeof resultObj?.error === "string"
        ? resultObj.error
        : "";
  const exitCode =
    typeof resultObj?.exitCode === "number"
      ? resultObj.exitCode
      : typeof resultObj?.code === "number"
        ? resultObj.code
        : 0;
  if (stderr.trim()) {
    logWarn(`openclaw ${command} stderr`, stderr.trim());
  }
  if (exitCode !== 0) {
    const combined = `${stdout}\n${stderr}`;
    if (/pairing required/i.test(combined)) {
      throw new Error(
        "Gateway pairing required for config updates. Run `openclaw devices list` and approve the pending operator request.",
      );
    }
    throw new Error(`openclaw gateway call ${command} failed with exit code ${exitCode}`);
  }
  const parsed = parseJsonFromMixedText(stdout);
  const stdoutTrimmed = stdout.trim();
  const stdoutNoAnsi = stripAnsi(stdout);
  logDebug("openclaw gateway call completed", {
    command,
    stdoutBytes: Buffer.byteLength(stdout, "utf8"),
    stdoutSha1: createHash("sha1").update(stdout).digest("hex").slice(0, 12),
    parsedAsJson: parsed !== null,
    parsedType: parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed,
    parsedKeys:
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).slice(0, 20)
        : [],
    containsBaseHashToken: /base[_-]?hash/i.test(stdoutNoAnsi),
  });
  return parsed ?? stdoutTrimmed;
}

export function findBaseHash(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    const parsed = parseJsonFromMixedText(value);
    if (parsed !== null) {
      return findBaseHash(parsed);
    }
    const text = stripAnsi(value);
    const regexes = [
      /"baseHash"\s*:\s*"([^"]+)"/i,
      /"base_hash"\s*:\s*"([^"]+)"/i,
      /\bbaseHash\b\s*[:=]\s*["']?([A-Za-z0-9._:-]+)["']?/i,
      /\bbase_hash\b\s*[:=]\s*["']?([A-Za-z0-9._:-]+)["']?/i,
    ];
    for (const re of regexes) {
      const matched = text.match(re);
      const candidate = matched?.[1]?.trim();
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findBaseHash(item);
      if (nested) {
        return nested;
      }
    }
    return "";
  }
  if (typeof value !== "object") {
    return "";
  }
  const obj = value as Record<string, unknown>;
  const directCandidates = [obj.baseHash, obj.base_hash, obj.hash, obj.configHash, obj.config_hash];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  for (const nested of Object.values(obj)) {
    const found = findBaseHash(nested);
    if (found) {
      return found;
    }
  }
  return "";
}
