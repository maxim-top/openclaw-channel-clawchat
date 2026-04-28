/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSessionMessageSyncSignal,
  extractSessionSyncDeliverySignal,
  removeOpenclawEdgeMention,
  stripLeadingAtMentions,
} from "./message.js";
import {
  extractSessionSyncText,
  sessionSyncTextsLookDuplicated,
} from "./session-message-sync.js";

test("session_message_sync command envelope is parsed as a control signal", () => {
  const ext = {
    openclaw: {
      type: "session_message_sync",
      session: "agent:main:clawchat-router:group:group-42",
      source: "control_ui_reply",
      messageId: "reply-1",
      message: {
        role: "assistant",
        content: "assistant reply that must not become inbound text",
      },
    },
  };

  assert.deepEqual(
    extractSessionMessageSyncSignal(
      {
        type: "command",
        ext: JSON.stringify(ext),
      },
      {},
    ),
    {
      type: "session_message_sync",
      session: "agent:main:clawchat-router:group:group-42",
      source: "control_ui_reply",
      role: "assistant",
      messageId: "reply-1",
    },
  );
});

test("session_message_sync signal reads snake_case message_id", () => {
  const ext = {
    openclaw: {
      type: "session_message_sync",
      session: "agent:main:clawchat:group:group-42",
      source: "control_ui_reply",
      message_id: "reply-snake-1",
      message: {
        role: "assistant",
        content: "assistant reply",
      },
    },
  };

  assert.deepEqual(
    extractSessionMessageSyncSignal(
      {
        type: "command",
        ext: JSON.stringify(ext),
      },
      {},
    ),
    {
      type: "session_message_sync",
      session: "agent:main:clawchat:group:group-42",
      source: "control_ui_reply",
      role: "assistant",
      messageId: "reply-snake-1",
    },
  );
});

test("non-session sync openclaw envelopes are ignored by the sync extractor", () => {
  assert.equal(
    extractSessionMessageSyncSignal(
      {
        type: "command",
        ext: JSON.stringify({
          openclaw: {
            type: "router_reply",
            message: {
              content: "reply",
            },
          },
        }),
      },
      {},
    ),
    null,
  );
});

test("session sync delivery marker is parsed from visible text messages", () => {
  assert.deepEqual(
    extractSessionSyncDeliverySignal(
      {
        type: "text",
        content: "assistant reply",
        ext: JSON.stringify({
          openclaw: {
            type: "session_sync_delivery",
            session: "agent:main:clawchat:direct:user-1",
            message_id: "delivery-1",
            source: "control_ui_reply",
            role: "assistant",
          },
        }),
      },
      {},
    ),
    {
      type: "session_sync_delivery",
      session: "agent:main:clawchat:direct:user-1",
      source: "control_ui_reply",
      role: "assistant",
      messageId: "delivery-1",
    },
  );
});

test("session sync text helpers flatten structured content and match parent follow-up drift", () => {
  const childResult = [
    {
      type: "text",
      text: "为什么数字4总是很开心？\n\n因为它总是可以“加”倍地兴奋！",
    },
  ];
  const parentFollowup =
    "为什么数字4总是很开心？\n\n因为它总是可以“加”倍地兴奋！希望这个笑话能给你带来快乐！";

  assert.equal(
    extractSessionSyncText(childResult),
    "为什么数字4总是很开心？\n\n因为它总是可以“加”倍地兴奋！",
  );
  assert.equal(sessionSyncTextsLookDuplicated(childResult, parentFollowup), true);
  assert.equal(sessionSyncTextsLookDuplicated(childResult, "这是完全不同的回复"), false);
});

test("removeOpenclawEdgeMention strips mention with unicode whitespace", () => {
  const input = "@openclaw_15_b121553b\u2006/subagents spawn main 讲个数字11的笑话吧";
  assert.equal(
    removeOpenclawEdgeMention(input, "openclaw_15_b121553b"),
    "/subagents spawn main 讲个数字11的笑话吧",
  );
});

test("stripLeadingAtMentions normalizes slash command with unmatched mention prefix", () => {
  const input = "@openclaw_alias /subagents spawn main 讲个数字22的笑话吧";
  assert.equal(
    stripLeadingAtMentions(input),
    "/subagents spawn main 讲个数字22的笑话吧",
  );
});
