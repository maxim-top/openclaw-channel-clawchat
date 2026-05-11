/// <reference types="node" />

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveClawchatPluginVersion, resolveClawchatSdkModulePath } from "./channel.js";

test("resolveClawchatPluginVersion supports source checkout layout", () => {
  const sourceModuleUrl = `file://${path.join(process.cwd(), "src", "channel.ts")}`;
  assert.equal(resolveClawchatPluginVersion(sourceModuleUrl), "1.0.27");
});

test("resolveClawchatPluginVersion supports packaged dist layout", () => {
  const distModuleUrl = `file://${path.join(process.cwd(), "dist", "src", "channel.js")}`;
  assert.equal(resolveClawchatPluginVersion(distModuleUrl), "1.0.27");
});

test("resolveClawchatSdkModulePath supports source checkout layout", () => {
  const sourceModuleUrl = `file://${path.join(process.cwd(), "src", "channel.ts")}`;
  assert.equal(
    resolveClawchatSdkModulePath(sourceModuleUrl),
    path.join(process.cwd(), "src", "lanying-im-sdk", "floo-3.0.0.js"),
  );
});

test("resolveClawchatSdkModulePath supports packaged dist layout", () => {
  const distModuleUrl = `file://${path.join(process.cwd(), "dist", "src", "channel.js")}`;
  assert.equal(
    resolveClawchatSdkModulePath(distModuleUrl),
    path.join(process.cwd(), "src", "lanying-im-sdk", "floo-3.0.0.js"),
  );
});
