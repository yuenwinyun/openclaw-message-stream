import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createMessageStreamService } from "./src/service.js";
import { messageStreamConfigSchema } from "./src/config.js";
import { registerMessageStreamCommand } from "./src/cli.js";

export default definePluginEntry({
  id: "openclaw-message-stream",
  name: "Message Stream Analyzer",
  description:
    "Continuously scan and analyze OpenClaw sessions for security-relevant patterns, PII, sentiment, and custom keywords.",
  configSchema: messageStreamConfigSchema,
  register(api) {
    if (api.registrationMode === "cli-metadata") {
      return;
    }
    api.registerService(createMessageStreamService(api));
    registerMessageStreamCommand(api);
  },
});
