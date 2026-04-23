export function shouldSkipSessionMessageSyncForRouterReply(params: {
  sessionKey?: string;
  source?: string;
  role?: string;
}): boolean {
  const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
  const source = typeof params.source === "string" ? params.source.trim() : "";
  const role = typeof params.role === "string" ? params.role.trim().toLowerCase() : "";

  if (!sessionKey || source !== "control_ui_reply" || role !== "assistant") {
    return false;
  }

  return (
    sessionKey.includes(":clawchat-router:group:") || sessionKey.includes(":clawchat-router:direct:")
  );
}
