import { createOpenClawCodingTools } from "./src/agents/pi-tools.js";
import { loadConfig } from "./src/config/io.js";

const config = loadConfig();
const tools = createOpenClawCodingTools({
  config,
  workspaceDir: process.cwd(),
  modelProvider: "google",
  modelId: "gemini-2.0-flash",
});

console.log(
  JSON.stringify(
    tools.map((t) => t.name),
    null,
    2,
  ),
);
