/**
 * Azure DevOps token management using the Azure CLI.
 * Gets access tokens for ADO API calls and work item creation.
 */

import { execSync } from 'child_process';

/** Azure DevOps resource ID for token requests */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

interface TokenResponse {
  accessToken: string;
  expiresOn: string;
  tokenType: string;
}

/**
 * Gets an Azure DevOps access token using the Azure CLI.
 * Requires user to be logged in via `az login`.
 *
 * @returns The access token string
 * @throws Error if az CLI is not available or user is not logged in
 */
export async function getAdoToken(): Promise<string> {
  // First check if PAT is set in environment (takes precedence)
  const pat = process.env.AZURE_DEVOPS_PAT;
  if (pat) {
    return pat;
  }

  try {
    const result = execSync(
      `az account get-access-token --resource ${ADO_RESOURCE_ID} --output json`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const tokenResponse: TokenResponse = JSON.parse(result);
    return tokenResponse.accessToken;
  } catch (error) {
    throw new Error(
      'Failed to get ADO token. Ensure you are logged in via `az login` or set AZURE_DEVOPS_PAT environment variable.\n' +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Configures the Azure DevOps CLI defaults for the given org and project.
 *
 * @param orgUrl - The ADO organization URL (e.g., https://dev.azure.com/myorg)
 * @param project - The project name
 */
export async function configureAdoDefaults(orgUrl: string, project: string): Promise<void> {
  try {
    execSync(`az devops configure --defaults organization="${orgUrl}" project="${project}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    throw new Error(
      `Failed to configure ADO defaults. Ensure az devops extension is installed.\n` +
      `Run: az extension add --name azure-devops\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Creates a work item in Azure DevOps using the CLI.
 *
 * @param type - Work item type (e.g., 'Epic', 'Feature', 'User Story', 'Task')
 * @param title - Work item title
 * @param description - Work item description (HTML supported)
 * @param parentId - Optional parent work item ID for hierarchy
 * @returns The created work item ID
 */
export async function createWorkItem(
  type: string,
  title: string,
  description: string,
  parentId?: number
): Promise<number> {
  const token = await getAdoToken();

  let command = `az boards work-item create --type "${type}" --title "${title.replace(/"/g, '\\"')}"`;

  if (description) {
    // Escape description for shell
    const escapedDesc = description.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    command += ` --description "${escapedDesc}"`;
  }

  if (parentId) {
    command += ` --parent ${parentId}`;
  }

  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AZURE_DEVOPS_EXT_PAT: token }
    });

    const workItem = JSON.parse(result);
    return workItem.id;
  } catch (error) {
    throw new Error(
      `Failed to create work item "${title}".\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
