import { clawchatPlugin } from "./src/channel.js";
import { setClawchatRuntime } from "./src/runtime.js";

type OpenClawPluginApi = {
  runtime: unknown;
  registerChannel: (params: { plugin: unknown }) => void;
};

const plugin = {
  id: "clawchat",
  name: "ClawChat",
  description: "ClawChat IM channel plugin for OpenClaw",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  register(api: OpenClawPluginApi) {
    setClawchatRuntime(api.runtime);
    api.registerChannel({ plugin: clawchatPlugin });
  },
};

export default plugin;
