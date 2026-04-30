import assert from "node:assert/strict";
import test from "node:test";

import { redactForLog } from "./logging.js";

test("keeps session-related fields visible for debugging", () => {
  const input = {
    merge_sub_sessions: true,
    session: "agent:main:subagent:child-1",
    parent_session_key: "agent:main:main",
    effective_target_session_key: "agent:main:main",
  };

  const redacted = redactForLog(input) as Record<string, unknown>;

  assert.equal(redacted.merge_sub_sessions, true);
  assert.equal(redacted.session, "agent:main:subagent:child-1");
  assert.equal(redacted.parent_session_key, "agent:main:main");
  assert.equal(redacted.effective_target_session_key, "agent:main:main");
});

test("still redacts credential-like fields", () => {
  const input = {
    token: "abc123",
    authorization: "Bearer xyz",
    api_key: "k-secret",
  };

  const redacted = redactForLog(input) as Record<string, unknown>;

  assert.equal(redacted.token, "******");
  assert.equal(redacted.authorization, "******");
  assert.equal(redacted.api_key, "******");
});
