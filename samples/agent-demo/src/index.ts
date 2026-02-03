#!/usr/bin/env node
/**
 * Agent Demo CLI
 *
 * A sample application demonstrating the use of Claude Code SDK and GitHub Copilot SDK
 * with WorkIQ MCP for gathering enterprise context and creating work items.
 *
 * Usage:
 *   npx tsx src/index.ts design "OAuth authentication system"
 *   npx tsx src/index.ts plan "PDF export feature" --project MyProject
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { runDesignCommand, runInteractiveDesign } from './commands/design.js';
import { runPlanCommand } from './commands/plan.js';
import { stopCopilotClient } from './agents/copilot-agent.js';

const program = new Command();

program
  .name('agent-demo')
  .description('Sample app demonstrating Claude Code SDK and Copilot SDK with WorkIQ MCP')
  .version('1.0.0');

// Design command
program
  .command('design')
  .description('Design a feature using Claude with WorkIQ enterprise context')
  .argument('<topic>', 'The topic or feature to design')
  .option('-o, --output <path>', 'Output path for the design document')
  .option('-i, --interactive', 'Run in interactive mode with follow-up questions')
  .option('-v, --verbose', 'Show detailed output including tool calls')
  .option('--no-workiq', 'Disable WorkIQ context gathering (use if experiencing MCP issues)')
  .action(async (topic: string, options: { output?: string; interactive?: boolean; verbose?: boolean; workiq?: boolean }) => {
    try {
      if (options.interactive) {
        await runInteractiveDesign(topic);
      } else {
        await runDesignCommand({
          topic,
          output: options.output,
          verbose: options.verbose,
          noWorkiq: options.workiq === false
        });
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Plan command
program
  .command('plan')
  .description('Create work items in Azure DevOps using Claude with WorkIQ context')
  .argument('<topic>', 'The topic or feature to plan')
  .option('-p, --project <name>', 'Azure DevOps project name')
  .option('-d, --dry-run', 'Preview the plan without creating work items')
  .option('-v, --verbose', 'Show detailed output including Claude\'s reasoning')
  .option('--no-workiq', 'Disable WorkIQ context gathering (use if experiencing MCP issues)')
  .action(async (topic: string, options: { project?: string; dryRun?: boolean; verbose?: boolean; workiq?: boolean }) => {
    try {
      await runPlanCommand({
        topic,
        project: options.project,
        dryRun: options.dryRun,
        verbose: options.verbose,
        noWorkiq: options.workiq === false
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Info command - shows configuration
program
  .command('info')
  .description('Show current configuration and environment')
  .action(() => {
    console.log(chalk.bold.blue('\n🔧 Agent Demo Configuration\n'));

    const envVars = [
      ['ADO_ORG_URL', process.env.ADO_ORG_URL || chalk.dim('(not set)')],
      ['ADO_PROJECT', process.env.ADO_PROJECT || chalk.dim('(not set)')],
      ['AZURE_DEVOPS_PAT', process.env.AZURE_DEVOPS_PAT ? chalk.green('(set)') : chalk.dim('(not set)')],
      ['WORKING_DIR', process.env.WORKING_DIR || process.cwd()],
      ['DOCS_OUTPUT_DIR', process.env.DOCS_OUTPUT_DIR || './docs/designs'],
    ];

    console.log(chalk.gray('Environment Variables:'));
    for (const [name, value] of envVars) {
      console.log(`  ${chalk.cyan(name)}: ${value}`);
    }

    console.log(chalk.gray('\nRequired Tools:'));
    console.log(`  ${chalk.cyan('az CLI')}: Run 'az --version' to verify`);
    console.log(`  ${chalk.cyan('az devops ext')}: Run 'az extension add --name azure-devops'`);
    console.log(`  ${chalk.cyan('Node.js')}: ${process.version}`);

    console.log(chalk.gray('\nMCP Servers:'));
    console.log(`  ${chalk.cyan('WorkIQ')}: @microsoft/workiq (auto-started via npx)`);

    console.log();
  });

// Setup command - helps configure the environment
program
  .command('setup')
  .description('Interactive setup to configure environment variables')
  .action(async () => {
    console.log(chalk.bold.blue('\n🛠️  Agent Demo Setup\n'));

    console.log(chalk.yellow('This command will guide you through setting up the environment.\n'));

    console.log(chalk.bold('Step 1: Azure CLI Login'));
    console.log('  Run: az login');
    console.log('  Then: az extension add --name azure-devops\n');

    console.log(chalk.bold('Step 2: Set Environment Variables'));
    console.log('  Create a .env file or export these variables:\n');
    console.log('  export ADO_ORG_URL="https://dev.azure.com/your-org"');
    console.log('  export ADO_PROJECT="your-project"');
    console.log('  # Optional: export AZURE_DEVOPS_PAT="your-pat-token"\n');

    console.log(chalk.bold('Step 3: Accept WorkIQ EULA'));
    console.log('  The first time you use WorkIQ, you\'ll need to accept the EULA.');
    console.log('  Visit: https://github.com/microsoft/work-iq-mcp\n');

    console.log(chalk.bold('Step 4: Test Configuration'));
    console.log('  Run: npx tsx src/index.ts info');
    console.log('  Run: npx tsx src/index.ts design "test" --dry-run\n');

    console.log(chalk.green('Setup instructions complete!'));
  });

// Test command - simple SDK test without MCP
program
  .command('test')
  .description('Test Claude Agent SDK with a simple query (no MCP)')
  .argument('[prompt]', 'Test prompt', 'Say hello and list 3 programming languages')
  .action(async (prompt: string) => {
    console.log(chalk.bold.blue('\n🧪 Testing Claude Agent SDK\n'));
    console.log(chalk.gray(`Prompt: ${prompt}\n`));

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const response = query({
        prompt,
        options: {
          model: 'sonnet',
          maxTurns: 1
        }
      });

      for await (const message of response) {
        if (message.type === 'assistant' && message.message?.content) {
          // Extract text from content blocks
          const content = message.message.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
          if (content) {
            console.log(chalk.green('Response:'), content);
          }
        } else if (message.type === 'system') {
          console.log(chalk.dim(`[${message.subtype}]`));
        } else if (message.type === 'result') {
          if (message.is_error) {
            console.error(chalk.red('Error:'), message.error);
          } else {
            console.log(chalk.dim(`\nCompleted in ${message.duration_ms}ms`));
          }
        }
      }

      console.log(chalk.green('\n✅ Test completed successfully'));
    } catch (error) {
      console.error(chalk.red('\n❌ Test failed:'));
      console.error(error);
      process.exit(1);
    }
  });

// Test WorkIQ command - test MCP integration
program
  .command('test-workiq')
  .description('Test WorkIQ MCP integration with a simple query')
  .argument('[query]', 'WorkIQ query', 'What meetings happened this week?')
  .action(async (queryText: string) => {
    console.log(chalk.bold.blue('\n🧪 Testing WorkIQ MCP Integration\n'));
    console.log(chalk.gray(`Query: ${queryText}\n`));

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const response = query({
        prompt: `Use the ask_work_iq tool to answer this question: "${queryText}". Only make ONE tool call.`,
        options: {
          model: 'sonnet',
          maxTurns: 3,
          permissionMode: 'bypassPermissions',
          mcpServers: {
            'workiq': {
              command: 'npx',
              args: ['-y', '@microsoft/workiq', 'mcp']
            }
          },
          allowedTools: ['mcp__workiq__ask_work_iq']
        }
      });

      for await (const message of response) {
        if (message.type === 'assistant' && message.message?.content) {
          const content = message.message.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
          if (content) {
            console.log(chalk.green('Response:'), content);
          }
        } else if (message.type === 'system') {
          console.log(chalk.dim(`[${message.subtype}]`));
        } else if (message.type === 'user' && message.message?.content) {
          // Tool results
          const results = message.message.content.filter((b: any) => b.type === 'tool_result');
          for (const result of results) {
            console.log(chalk.cyan('WorkIQ Result:'), typeof result.content === 'string'
              ? result.content.slice(0, 500) + '...'
              : JSON.stringify(result.content).slice(0, 500) + '...');
          }
        } else if (message.type === 'result') {
          if (message.is_error) {
            console.error(chalk.red('Error:'), message.error);
          } else {
            console.log(chalk.dim(`\nCompleted in ${message.duration_ms}ms`));
          }
        }
      }

      console.log(chalk.green('\n✅ Test completed successfully'));
    } catch (error) {
      console.error(chalk.red('\n❌ Test failed:'));
      console.error(error);
      process.exit(1);
    }
  });

// Test Copilot SDK command
program
  .command('test-copilot')
  .description('Test GitHub Copilot SDK with a code generation task')
  .argument('[prompt]', 'Code generation prompt', 'Write a TypeScript function to validate an email address')
  .action(async (prompt: string) => {
    console.log(chalk.bold.blue('\n🤖 Testing GitHub Copilot SDK\n'));
    console.log(chalk.gray(`Prompt: ${prompt}\n`));

    try {
      const { runCopilotAgent } = await import('./agents/copilot-agent.js');

      console.log(chalk.cyan('Starting Copilot session...\n'));

      for await (const message of runCopilotAgent({
        prompt,
        model: 'gpt-5',
        streaming: true,
        systemMessage: 'You are a code generation assistant. Generate clean, well-documented TypeScript code.'
      })) {
        switch (message.type) {
          case 'assistant.message':
            console.log(chalk.green('Response:'), message.content);
            break;
          case 'assistant.message_delta':
            process.stdout.write(message.content);
            break;
          case 'tool.execution_start':
            console.log(chalk.cyan(`\n  → Tool: ${message.toolName}`));
            break;
          case 'tool.execution_end':
            console.log(chalk.dim(`  ← Done: ${message.toolName}`));
            break;
          case 'session.error':
            console.error(chalk.red('Error:'), message.content);
            break;
        }
      }

      console.log(chalk.green('\n\n✅ Copilot test completed successfully'));
    } catch (error) {
      console.error(chalk.red('\n❌ Copilot test failed:'));
      console.error(error);
      process.exit(1);
    }
  });

// Test Copilot with WorkIQ command
program
  .command('test-copilot-workiq')
  .description('Test GitHub Copilot SDK with WorkIQ MCP integration')
  .argument('[query]', 'Query for WorkIQ', 'What meetings discussed authentication or security features?')
  .action(async (query: string) => {
    console.log(chalk.bold.blue('\n🤖 Testing Copilot SDK + WorkIQ MCP\n'));
    console.log(chalk.gray(`Query: ${query}\n`));

    try {
      const { runCopilotAgent } = await import('./agents/copilot-agent.js');

      console.log(chalk.cyan('Starting Copilot session with WorkIQ MCP...\n'));

      for await (const message of runCopilotAgent({
        prompt: `Use the ask_work_iq tool to answer this question: "${query}". Summarize the findings.`,
        model: 'gpt-5',
        streaming: true,
        systemMessage: 'You are a helpful assistant that gathers enterprise context using WorkIQ. Use the ask_work_iq tool to search for relevant meetings, documents, and emails.',
        mcpServers: {
          'workiq': {
            type: 'local',
            command: 'npx',
            args: ['-y', '@microsoft/workiq', 'mcp'],
            tools: '*',
            timeout: 60000
          }
        }
      })) {
        switch (message.type) {
          case 'assistant.message':
            console.log(chalk.green('\nResponse:'), message.content);
            break;
          case 'assistant.message_delta':
            process.stdout.write(message.content);
            break;
          case 'tool.execution_start':
            console.log(chalk.cyan(`\n  🔍 Calling: ${message.toolName}`));
            break;
          case 'tool.execution_end':
            console.log(chalk.cyan(`  ✓ ${message.toolName} result:`));
            console.log(chalk.dim(`    ${message.content.slice(0, 300)}...`));
            break;
          case 'session.error':
            console.error(chalk.red('Error:'), message.content);
            break;
        }
      }

      console.log(chalk.green('\n\n✅ Copilot + WorkIQ test completed'));
    } catch (error) {
      console.error(chalk.red('\n❌ Test failed:'));
      console.error(error);
      process.exit(1);
    }
  });

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.log(chalk.dim('\nShutting down...'));
  await stopCopilotClient();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopCopilotClient();
  process.exit(0);
});

// Parse and execute
program.parse();
