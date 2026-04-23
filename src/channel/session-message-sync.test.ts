/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipSessionMessageSyncForRouterReply } from "./session-message-sync.js";

test("router root assistant replies skip session_message_sync because router_reply is authoritative", () => {
  assert.equal(
    shouldSkipSessionMessageSyncForRouterReply({
      sessionKey: "agent:main:clawchat-router:group:group-42",
      source: "control_ui_reply",
      role: "assistant",
    }),
    true,
  );
  assert.equal(
    shouldSkipSessionMessageSyncForRouterReply({
      sessionKey: "agent:main:clawchat-router:direct:user-42",
      source: "control_ui_reply",
      role: "assistant",
    }),
    true,
  );
});

test("non-router or non-assistant transcript updates still sync normally", () => {
  assert.equal(
    shouldSkipSessionMessageSyncForRouterReply({
      sessionKey: "agent:main:subagent:test-child",
      source: "control_ui_reply",
      role: "assistant",
    }),
    false,
  );
  assert.equal(
    shouldSkipSessionMessageSyncForRouterReply({
      sessionKey: "agent:main:clawchat-router:group:group-42",
      source: "control_ui_user",
      role: "user",
    }),
    false,
  );
});
