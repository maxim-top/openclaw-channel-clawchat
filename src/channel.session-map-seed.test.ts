/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import { shouldSeedSessionMappingFromLocalStoreEntry } from "./channel.js";

test("ended root session is still eligible for session map seed", () => {
  assert.equal(
    shouldSeedSessionMappingFromLocalStoreEntry({
      sessionKey: "agent:main:main",
      endedAt: Date.now(),
    }),
    true,
  );
});

test("ended child session is filtered out from session map seed", () => {
  assert.equal(
    shouldSeedSessionMappingFromLocalStoreEntry({
      sessionKey: "agent:main:subagent:child-1",
      endedAt: Date.now(),
      parentSessionKey: "agent:main:main",
    }),
    false,
  );
});

test("clawchat-created session is filtered out from session map seed", () => {
  assert.equal(
    shouldSeedSessionMappingFromLocalStoreEntry({
      sessionKey: "agent:main:clawchat:group:group-1",
    }),
    false,
  );
});
