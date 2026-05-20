import type { Command } from "commander";
import { runOnboardWebAuth } from "../../commands/onboard-web-auth.js";

export function registerOnboardWebAuthCommand(program: Command) {
  program
    .command("webauth")
    .description("Web 模型授权向导 - 授权 Claude/ChatGPT/DeepSeek 等无需 API Key 的 Web 模型")
    .action(async () => {
      await runOnboardWebAuth();
      // Playwright browser connections and timers keep the process alive.
      // Force exit after auth completes so the user returns to the terminal.
      process.exit(0);
    });
}
