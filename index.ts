import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createMessageStreamService } from "./src/service.js";
import { messageStreamConfigSchema } from "./src/config.js";
import { registerMessageStreamCommand } from "./src/cli.js";

const RUN_COMMAND_NAME = "msgstream";

function isCliCommandInvocation(): boolean {
  return process.argv.includes(RUN_COMMAND_NAME);
}

export default definePluginEntry({
  id: "openclaw-message-stream",
  name: "Message Stream Analyzer",
  description:
    "Continuously scan and analyze OpenClaw sessions for security-relevant patterns, PII, sentiment, and custom keywords.",
  configSchema: messageStreamConfigSchema,
  register(api) {
    if (api.registrationMode === "cli-metadata") {
      registerMessageStreamCommand(api);
      return;
    }
    if (!isCliCommandInvocation()) {
      api.registerService(createMessageStreamService(api));
    }
    registerMessageStreamCommand(api);
  },
});
