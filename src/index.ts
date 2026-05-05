import { Command } from "commander";
import { setupAction } from "./commands/setup.js";
import { statusAction } from "./commands/status.js";
import { generateAction } from "./commands/generate.js";
import { resetAction } from "./commands/reset.js";
import type { GenerateOptions } from "./commands/generate.js";

const program = new Command();

program
  .name("sprint-report")
  .description("Generate sprint reports from Linear and GitHub")
  .version("2.0.0");

program
  .command("setup")
  .description("Interactive setup wizard")
  .action(async () => {
    try {
      await setupAction();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current configuration and connection health")
  .action(async () => {
    try {
      await statusAction();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("reset")
  .description("Delete all configuration, API keys, and report history")
  .action(async () => {
    try {
      await resetAction();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const generateCmd = program
  .command("generate", { isDefault: true })
  .description("Generate a sprint report")
  .option("--sprint-start <date>", "Override sprint start day (YYYY-MM-DD)")
  .option("--sprint-length <weeks>", "Override sprint length in weeks")
  .option("--author <username>", "GitHub username to report for, or 'all'")
  .option("--repos <names>", "Comma-separated repo names to include")
  .option("--config <path>", "Path to config JSON file")
  .option("--output <path>", "Output HTML file path", "./sprint-report.html")
  .option("--format <format>", "Output: html, markdown, both", "both")
  .option("--no-ai", "Skip AI summarization, output raw grouped data")
  .option("--dry-run", "Fetch data only, print stats")
  .option("--verbose", "Print debug information")
  .action(async (options: GenerateOptions) => {
    try {
      await generateAction(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
