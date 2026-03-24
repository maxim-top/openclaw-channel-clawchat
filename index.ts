import { lanyingPlugin } from "./src/channel.js";
import { setLanyingRuntime } from "./src/runtime.js";

type OpenClawPluginApi = {
  runtime: unknown;
  registerChannel: (params: { plugin: unknown }) => void;
};

const plugin = {
  id: "lanying",
  name: "Lanying",
  description: "Lanying IM channel plugin for OpenClaw",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  register(api: OpenClawPluginApi) {
    setLanyingRuntime(api.runtime);
    api.registerChannel({ plugin: lanyingPlugin });
  },
};

export default plugin;
