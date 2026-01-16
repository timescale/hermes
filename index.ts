#!/usr/bin/env bun

// ============================================================================
// Conductor CLI - Automates branch + database fork + agent sandbox creation
// ============================================================================

interface ParsedArgs {
  command: string | null;
  prompt: string | null;
  serviceId: string | null;
}

interface ForkResult {
  service_id: string;
  name: string;
  envVars: Record<string, string>; // PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
}

// ============================================================================
// Command Execution Helper
// ============================================================================

interface ShellError extends Error {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

function formatShellError(error: ShellError): Error {
  const stdout = error.stdout?.toString().trim();
  const stderr = error.stderr?.toString().trim();
  const details = [
    stderr && `stderr: ${stderr}`,
    stdout && `stdout: ${stdout}`,
  ]
    .filter(Boolean)
    .join("\n");

  return new Error(
    `Command failed (exit code ${error.exitCode})${details ? `\n${details}` : ""}`
  );
}

// ============================================================================
// Argument Parsing
// ============================================================================

function printUsage(): void {
  console.log(`Usage: conductor branch "<prompt>" [--service-id <id>]

Creates a new feature branch with an isolated database fork and starts
a sandboxed Claude Code agent to work on the task.

Arguments:
  <prompt>              Natural language description of the task

Options:
  --service-id <id>     Database service ID to fork (defaults to tiger's default)

Examples:
  conductor branch "Add user authentication with OAuth"
  conductor branch "Fix the bug in payment processing" --service-id svc-12345
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: null,
    prompt: null,
    serviceId: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--service-id") {
      i++;
      const serviceId = argv[i];
      if (serviceId) {
        result.serviceId = serviceId;
      }
    } else if (arg.startsWith("--")) {
      // Unknown flag, skip
    } else if (!result.command) {
      result.command = arg;
    } else if (!result.prompt) {
      result.prompt = arg;
    }
  }

  return result;
}

// ============================================================================
// Branch Name Generation
// ============================================================================

function isValidBranchName(name: string): boolean {
  // Must start with letter, contain only lowercase letters, numbers, hyphens
  // Must end with letter or number, max 50 chars
  if (name.length === 0 || name.length > 50) return false;
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && !/^[a-z]$/.test(name))
    return false;
  if (name.includes("--")) return false; // No double hyphens
  return true;
}

async function getExistingBranches(): Promise<string[]> {
  try {
    const result = await Bun.$`git branch --list`.quiet();
    return result.stdout
      .toString()
      .split("\n")
      .map((line) => line.replace(/^\*?\s*/, "").trim())
      .filter(Boolean);
  } catch (err) {
    throw formatShellError(err as ShellError);
  }
}

async function getExistingServices(): Promise<string[]> {
  try {
    const result = await Bun.$`tiger svc list -o json`.quiet();
    const services = JSON.parse(result.stdout.toString());
    return services.map((svc: { name: string }) => svc.name);
  } catch {
    // tiger CLI not available or no services, return empty array
    return [];
  }
}

async function getExistingContainers(): Promise<string[]> {
  try {
    // Get all container names (running and stopped), strip "conductor-" prefix if present
    const result = await Bun.$`docker ps -a --format {{.Names}}`.quiet();
    return result.stdout
      .toString()
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => name.replace(/^conductor-/, "")); // Normalize to branch name format
  } catch {
    // Docker not available, return empty array
    return [];
  }
}

async function generateBranchName(
  prompt: string,
  maxRetries: number = 3
): Promise<string> {
  // Gather all existing names to avoid conflicts
  const [existingBranches, existingServices, existingContainers] =
    await Promise.all([
      getExistingBranches(),
      getExistingServices(),
      getExistingContainers(),
    ]);

  const allExistingNames = new Set([
    ...existingBranches,
    ...existingServices,
    ...existingContainers,
  ]);

  let lastAttempt = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let claudePrompt = `Generate a git branch name for the following task: ${prompt}

Requirements:
- Output ONLY the branch name, nothing else
- Lowercase letters, numbers, and hyphens only
- No special characters, spaces, or underscores
- Keep it concise (2-4 words max)
- Example format: add-user-auth, fix-login-bug`;

    if (allExistingNames.size > 0) {
      claudePrompt += `\n\nIMPORTANT: Do NOT use any of these names (they already exist):
${[...allExistingNames].join(", ")}`;
    }

    if (lastAttempt) {
      claudePrompt += `\n\nThe name '${lastAttempt}' is invalid. Suggest a different name.`;
    }

    let result: string;
    try {
      const proc = await Bun.$`claude --model haiku -p ${claudePrompt}`.quiet();
      result = proc.stdout.toString();
    } catch (err) {
      throw formatShellError(err as ShellError);
    }
    const branchName = result.trim().toLowerCase();

    // Clean up any quotes or extra whitespace
    const cleaned = branchName.replace(/['"]/g, "").trim();

    if (!isValidBranchName(cleaned)) {
      console.log(
        `  Attempt ${attempt}: '${cleaned}' is not a valid branch name`
      );
      lastAttempt = cleaned;
      continue;
    }

    if (allExistingNames.has(cleaned)) {
      console.log(`  Attempt ${attempt}: '${cleaned}' already exists`);
      lastAttempt = cleaned;
      allExistingNames.add(cleaned); // Add to set to avoid suggesting again
      continue;
    }

    return cleaned;
  }

  throw new Error(`Failed to generate valid branch name after ${maxRetries} attempts`);
}

// ============================================================================
// Git Repository Info
// ============================================================================

interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string; // owner/repo
}

async function getRepoInfo(): Promise<RepoInfo> {
  let remoteUrl: string;
  try {
    const result = await Bun.$`git remote get-url origin`.quiet();
    remoteUrl = result.stdout.toString().trim();
  } catch (err) {
    throw formatShellError(err as ShellError);
  }

  // Parse GitHub URL (supports both HTTPS and SSH formats)
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  let repoPath = remoteUrl;
  repoPath = repoPath.replace(/^https:\/\/github\.com\//, "");
  repoPath = repoPath.replace(/^git@github\.com:/, "");
  repoPath = repoPath.replace(/\.git$/, "");

  const parts = repoPath.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Unable to parse GitHub repository from remote URL: ${remoteUrl}`);
  }

  return {
    owner: parts[0],
    repo: parts[1],
    fullName: repoPath,
  };
}

// ============================================================================
// Gitignore Management
// ============================================================================

async function ensureGitignore(): Promise<void> {
  const gitignorePath = ".gitignore";
  const entry = ".conductor/";

  const file = Bun.file(gitignorePath);
  let content = "";

  if (await file.exists()) {
    content = await file.text();
  }

  // Check if .conductor/ is already in gitignore
  const lines = content.split("\n");
  const hasEntry = lines.some(
    (line) => line.trim() === ".conductor/" || line.trim() === ".conductor"
  );

  if (!hasEntry) {
    // Append entry, ensuring there's a newline before it if file doesn't end with one
    const newContent = content.endsWith("\n") || content === ""
      ? content + entry + "\n"
      : content + "\n" + entry + "\n";

    await Bun.write(gitignorePath, newContent);
    console.log("  Added .conductor/ to .gitignore");
  }
}

// ============================================================================
// Database Fork
// ============================================================================

function parseEnvOutput(output: string): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIndex);
    const value = trimmed.substring(eqIndex + 1);
    envVars[key] = value;
  }
  return envVars;
}

async function forkDatabase(
  branchName: string,
  serviceId?: string | null
): Promise<ForkResult> {
  const baseArgs = serviceId ? [serviceId] : [];
  const forkArgs = ["--now", "--name", branchName, "--with-password"];

  // Fork and get JSON output for metadata (service_id, name)
  let jsonOutput: string;
  try {
    const proc = await Bun.$`tiger svc fork ${baseArgs} ${forkArgs} -o json`.quiet();
    jsonOutput = proc.stdout.toString();
  } catch (err) {
    throw formatShellError(err as ShellError);
  }
  const metadata = JSON.parse(jsonOutput);

  // Get env output for the PG* variables using the new service's ID
  let envOutput: string;
  try {
    const proc = await Bun.$`tiger svc get ${metadata.service_id} -o env --with-password`.quiet();
    envOutput = proc.stdout.toString();
  } catch (err) {
    throw formatShellError(err as ShellError);
  }
  const envVars = parseEnvOutput(envOutput);

  return {
    service_id: metadata.service_id,
    name: metadata.name,
    envVars,
  };
}

// ============================================================================
// Docker Container
// ============================================================================

async function startContainer(
  branchName: string,
  prompt: string,
  repoInfo: RepoInfo,
  envVars: Record<string, string>
): Promise<string> {
  const conductorEnvPath = ".conductor/.env";
  const conductorEnvFile = Bun.file(conductorEnvPath);

  // Create empty .conductor/.env if it doesn't exist
  if (!(await conductorEnvFile.exists())) {
    await Bun.write(conductorEnvPath, "");
  }

  const containerName = `conductor-${branchName}`;

  // Build env var arguments for docker run
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    envArgs.push("-e", `${key}=${value}`);
  }

  // Build the startup script that:
  // 1. Clones the repo using gh
  // 2. Creates and checks out the new branch
  // 3. Runs claude with the prompt
  const startupScript = `
set -e
cd /work
gh auth setup-git
gh repo clone ${repoInfo.fullName} app
cd app
git switch -c "conductor/${branchName}"
exec claude -p --dangerously-skip-permissions \\
  "${prompt.replace(/"/g, '\\"')}

Use the \\\`gh\\\` command to create a PR when done."
`.trim();

  try {
    const result = await Bun.$`docker run -d \
      --name ${containerName} \
      --env-file ${conductorEnvPath} \
      ${envArgs} \
      conductor-sandbox \
      bash -c ${startupScript}`;
    return result.stdout.toString().trim();
  } catch (err) {
    throw formatShellError(err as ShellError);
  }
}

// ============================================================================
// Summary Output
// ============================================================================

function printSummary(
  branchName: string,
  repoInfo: RepoInfo,
  forkResult: ForkResult,
  containerId: string
): void {
  console.log(`
Repository: ${repoInfo.fullName}
Branch: conductor/${branchName}
Database: ${forkResult.name} (service ID: ${forkResult.service_id})
Container: conductor-${branchName}

To view agent logs:
  docker logs -f conductor-${branchName}

To stop the agent:
  docker stop conductor-${branchName}
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command !== "branch" || !args.prompt) {
    printUsage();
    process.exit(1);
  }

  const prompt = args.prompt;

  // Step 1: Get repo info
  console.log("Getting repository info...");
  const repoInfo = await getRepoInfo();
  console.log(`  Repository: ${repoInfo.fullName}`);

  // Step 2: Generate branch name
  console.log("Generating branch name...");
  const branchName = await generateBranchName(prompt);
  console.log(`  Branch name: ${branchName}`);

  // Step 3: Ensure .gitignore has .conductor/ entry
  await ensureGitignore();

  // Step 4: Fork database
  console.log("Forking database (this may take a few minutes)...");
  const forkResult = await forkDatabase(branchName, args.serviceId);
  console.log(`  Database fork created: ${forkResult.name}`);

  // Step 5: Start container (repo will be cloned inside container)
  console.log("Starting agent container...");
  const containerId = await startContainer(branchName, prompt, repoInfo, forkResult.envVars);
  console.log(`  Container started: ${containerId.substring(0, 12)}`);

  // Summary
  printSummary(branchName, repoInfo, forkResult, containerId);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
