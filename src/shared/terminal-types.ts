// Terminal session types for console-based AI review

export interface TerminalSession {
  id: string;
  label: string;
  status: 'starting' | 'running' | 'completed' | 'error';
  prId: number;
  organization: string;
  project: string;
  workingDir: string;
  contextPath: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
  worktreeCreated?: boolean; // true if we created the worktree (for cleanup)
  mainRepoPath?: string; // the main repo path (for worktree removal)
}

export interface CreateTerminalOptions {
  prId: number;
  organization: string;
  project: string;
  label: string;
  workingDir: string;
  contextPath: string;
  outputPath: string; // Where to write prompt.txt and done.json
  prompt: string;
  completionGuid?: string; // The guid used in the prompt for the done.json file
  worktreeCreated?: boolean; // true if we created the worktree (for cleanup)
  mainRepoPath?: string; // the main repo path (for worktree removal)
  cliCommand?: string; // CLI command to run (default: 'claude')
  cliArgs?: string[]; // Additional CLI arguments before the instruction
}

export interface LinkedRepository {
  path: string;
  originUrl: string;
  /** Optional human-readable description of what this repository contains */
  description?: string;
}

export interface MonitoredRepository {
  /** ADO repository URL (e.g., https://dev.azure.com/org/project/_git/repo) */
  url: string;
  /** Display name for the repository */
  name: string;
  /** Organization extracted from URL */
  organization: string;
  /** Project extracted from URL */
  project: string;
  /** Repository name extracted from URL */
  repository: string;
}

export interface ConsoleReviewSettings {
  linkedRepositories: LinkedRepository[];
  monitoredRepositories: MonitoredRepository[];
  whenRepoFound: 'ask' | 'worktree' | 'tempOnly';
  whenRepoNotFound: 'ask' | 'immediate' | 'clone';
  autoCloseTerminal: boolean;
  showNotification: boolean;
  worktreeCleanup: 'ask' | 'auto' | 'never';
  /** Default AI for chat panel: copilot or claude */
  defaultChatAI: 'copilot' | 'claude';
  generatedFilePatterns: string[];  // Glob patterns for generated files (e.g., *.g.cs, *.json)
  /** Enable WorkIQ to gather recent related information for PR context */
  enableWorkIQ: boolean;
  analyzeComments: {
    provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
    showTerminal: boolean;
    timeoutMinutes: number;
  };
  applyChanges: {
    provider: 'claude-sdk' | 'claude-terminal' | 'copilot-sdk' | 'copilot-terminal';
    showTerminal: boolean;
    timeoutMinutes: number;
  };
  dgrepAnalysis: {
    provider: 'claude-sdk' | 'copilot-sdk';
    /** Path to linked source repo for code correlation (empty = none) */
    sourceRepository: string;
  };
}

export const DEFAULT_CONSOLE_REVIEW_SETTINGS: ConsoleReviewSettings = {
  linkedRepositories: [],
  monitoredRepositories: [],
  whenRepoFound: 'worktree',
  whenRepoNotFound: 'immediate',
  autoCloseTerminal: true,
  showNotification: true,
  worktreeCleanup: 'auto',
  defaultChatAI: 'copilot',
  generatedFilePatterns: [],
  enableWorkIQ: true,
  analyzeComments: {
    provider: 'claude-sdk',
    showTerminal: false,
    timeoutMinutes: 5,
  },
  applyChanges: {
    provider: 'claude-terminal',
    showTerminal: false,
    timeoutMinutes: 5,
  },
  dgrepAnalysis: {
    provider: 'claude-sdk',
    sourceRepository: '',
  },
};
