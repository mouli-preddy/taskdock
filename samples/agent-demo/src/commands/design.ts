/**
 * Design command - Creates design documents using Claude with WorkIQ context.
 *
 * Workflow:
 * 1. Gathers enterprise context via WorkIQ MCP (meetings, docs, emails)
 * 2. Claude synthesizes context and asks clarifying questions
 * 3. Generates a comprehensive design document
 * 4. Saves to docs/designs/ directory
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { runDesignSession, AgentMessage } from '../agents/claude-agent.js';
import { config } from '../config.js';

export interface DesignOptions {
  /** Topic/feature to design */
  topic: string;
  /** Output file path (optional, auto-generated if not provided) */
  output?: string;
  /** Skip WorkIQ context gathering */
  skipContext?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Disable WorkIQ MCP */
  noWorkiq?: boolean;
}

/**
 * Generates a filename-safe slug from a topic.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Gets the output path for the design document.
 */
function getOutputPath(topic: string, customPath?: string): string {
  if (customPath) {
    return customPath;
  }

  const date = new Date().toISOString().split('T')[0];
  const slug = slugify(topic);
  const filename = `${date}-${slug}-design.md`;

  return path.join(config.docsOutputDir, filename);
}

/**
 * Ensures the output directory exists.
 */
function ensureOutputDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Formats agent messages for console output.
 */
function formatMessage(message: AgentMessage, verbose: boolean): string | null {
  switch (message.type) {
    case 'assistant':
      return message.content;

    case 'tool_use':
      if (verbose) {
        return chalk.dim(`  → Using tool: ${message.toolName}`);
      }
      if (message.toolName === 'ask_work_iq') {
        return chalk.cyan(`  🔍 Querying WorkIQ: ${message.content.slice(0, 100)}...`);
      }
      return null;

    case 'tool_result':
      if (verbose) {
        return chalk.dim(`  ← Tool result: ${message.content.slice(0, 200)}...`);
      }
      return null;

    case 'system':
      if (verbose) {
        return chalk.gray(`  [${message.subtype}] ${message.content}`);
      }
      return null;

    default:
      return null;
  }
}

/**
 * Extracts the design document content from the agent's output.
 * Looks for markdown content between specific markers or the full response.
 */
function extractDesignDocument(messages: AgentMessage[]): string {
  // Collect all assistant messages
  const assistantContent = messages
    .filter(m => m.type === 'assistant')
    .map(m => m.content)
    .join('\n\n');

  // Look for markdown document markers
  const docStart = assistantContent.indexOf('# ');
  if (docStart !== -1) {
    return assistantContent.slice(docStart);
  }

  return assistantContent;
}

/**
 * Runs the design command.
 *
 * @param options - Design command options
 */
export async function runDesignCommand(options: DesignOptions): Promise<void> {
  const { topic, output, verbose = false, noWorkiq = false } = options;
  const useWorkIQ = !noWorkiq;

  console.log(chalk.bold.blue('\n📐 Design Session\n'));
  console.log(chalk.gray(`Topic: ${topic}`));
  if (useWorkIQ) {
    console.log(chalk.gray(`Using WorkIQ for enterprise context gathering\n`));
  } else {
    console.log(chalk.yellow(`WorkIQ disabled - running without enterprise context\n`));
  }
  console.log(chalk.dim('─'.repeat(60)));

  const outputPath = getOutputPath(topic, output);
  const collectedMessages: AgentMessage[] = [];

  try {
    // Run the design session
    for await (const message of runDesignSession(topic, useWorkIQ)) {
      collectedMessages.push(message);

      const formatted = formatMessage(message, verbose);
      if (formatted) {
        console.log(formatted);
      }
    }

    // Extract and save the design document
    const designDoc = extractDesignDocument(collectedMessages);

    if (designDoc.trim()) {
      ensureOutputDir(outputPath);
      fs.writeFileSync(outputPath, designDoc, 'utf-8');

      console.log(chalk.dim('\n' + '─'.repeat(60)));
      console.log(chalk.green(`\n✅ Design document saved to: ${outputPath}`));
    } else {
      console.log(chalk.yellow('\n⚠️  No design document was generated.'));
    }

  } catch (error) {
    console.error(chalk.red('\n❌ Design session failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

/**
 * Interactive design mode - asks follow-up questions.
 */
export async function runInteractiveDesign(topic: string): Promise<void> {
  console.log(chalk.bold.blue('\n📐 Interactive Design Session\n'));
  console.log(chalk.gray(`Topic: ${topic}`));
  console.log(chalk.gray('This session will gather context and ask clarifying questions.\n'));
  console.log(chalk.dim('─'.repeat(60)));

  // For interactive mode, we'd integrate with readline or inquirer
  // For now, run the standard design session
  await runDesignCommand({ topic, verbose: true });
}
