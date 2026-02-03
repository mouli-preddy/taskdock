/**
 * Configuration for the agent-demo application.
 * Loads settings from environment variables.
 */

export interface Config {
  /** Azure DevOps organization URL (e.g., https://dev.azure.com/myorg) */
  adoOrgUrl: string;
  /** Azure DevOps project name */
  adoProject: string;
  /** Working directory for file operations */
  workingDirectory: string;
  /** Output directory for generated design documents */
  docsOutputDir: string;
}

export function loadConfig(): Config {
  const adoOrgUrl = process.env.ADO_ORG_URL;
  const adoProject = process.env.ADO_PROJECT;

  if (!adoOrgUrl) {
    console.warn('Warning: ADO_ORG_URL not set. Work item creation will fail.');
  }
  if (!adoProject) {
    console.warn('Warning: ADO_PROJECT not set. Work item creation will fail.');
  }

  return {
    adoOrgUrl: adoOrgUrl || '',
    adoProject: adoProject || '',
    workingDirectory: process.env.WORKING_DIR || process.cwd(),
    docsOutputDir: process.env.DOCS_OUTPUT_DIR || './docs/designs',
  };
}

export const config = loadConfig();
