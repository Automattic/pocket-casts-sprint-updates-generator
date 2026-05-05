import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { rmSync, existsSync } from "node:fs";
import { CONFIG_DIR, CONFIG_PATH, ENV_PATH, HISTORY_PATH } from "../config.js";

export async function resetAction(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    console.log("Nothing to reset -- no config directory found.");
    return;
  }

  console.log("\nThis will delete all sprint-report configuration:");
  console.log(`  ${CONFIG_PATH}`);
  console.log(`  ${ENV_PATH}`);
  console.log(`  ${HISTORY_PATH}`);
  console.log("");

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question("Are you sure? (yes/no): ");
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Cancelled.");
      return;
    }
  } finally {
    rl.close();
  }

  rmSync(CONFIG_DIR, { recursive: true, force: true });
  console.log(`\nDeleted ${CONFIG_DIR}`);
  console.log("Run 'sprint-report setup' to start fresh.");
}
