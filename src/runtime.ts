export type PluginRuntime = any;

let runtime: PluginRuntime | null = null;

export function setClawchatRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getClawchatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("ClawChat runtime not initialized");
  }
  return runtime;
}
