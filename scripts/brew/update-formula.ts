#!/usr/bin/env bun

// Generates and publishes the Homebrew formula for the ox CLI.
//
// Computes SHA256 hashes of the release binaries, generates the ox.rb formula,
// then clones timescale/homebrew-tap and pushes the updated formula.
//
// Usage:
//   ./bun scripts/brew/update-formula.ts --version 0.13.0 --binaries-dir ./binaries [--dry-run]
//
// Requires HOMEBREW_TAP_GITHUB_TOKEN env var for pushing to the tap repo.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const TAP_REPO = 'timescale/homebrew-tap';
const FORMULA_FILE = 'ox.rb';

interface PlatformTarget {
  os: string;
  arch: string;
  binaryName: string;
  /** Ruby block nesting: on_macos/on_linux > on_arm/on_intel */
  rubyOs: string;
  rubyArch: string;
}

const PLATFORMS: PlatformTarget[] = [
  {
    os: 'darwin',
    arch: 'arm64',
    binaryName: 'ox-darwin-arm64',
    rubyOs: 'on_macos',
    rubyArch: 'on_arm',
  },
  {
    os: 'linux',
    arch: 'arm64',
    binaryName: 'ox-linux-arm64',
    rubyOs: 'on_linux',
    rubyArch: 'on_arm',
  },
  {
    os: 'linux',
    arch: 'x64',
    binaryName: 'ox-linux-x64',
    rubyOs: 'on_linux',
    rubyArch: 'on_intel',
  },
];

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function sha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function run(
  cmd: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if (exitCode !== 0) {
    fail(`Command failed (exit ${exitCode}): ${cmd.join(' ')}\n${stderr}`);
  }
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

function generateFormula(version: string, hashes: Map<string, string>): string {
  // Group platforms by OS for Ruby nesting
  const byOs = new Map<string, PlatformTarget[]>();
  for (const p of PLATFORMS) {
    const list = byOs.get(p.rubyOs) ?? [];
    list.push(p);
    byOs.set(p.rubyOs, list);
  }

  let platformBlocks = '';
  for (const [rubyOs, targets] of byOs) {
    platformBlocks += `\n  ${rubyOs} do\n`;
    for (const t of targets) {
      const hash = hashes.get(t.binaryName);
      if (!hash) fail(`Missing hash for ${t.binaryName}`);
      platformBlocks += `    ${t.rubyArch} do\n`;
      platformBlocks += `      url "https://github.com/timescale/ox/releases/download/v#{version}/${t.binaryName}"\n`;
      platformBlocks += `      sha256 "${hash}"\n`;
      platformBlocks += `    end\n`;
    }
    platformBlocks += `  end\n`;
  }

  return `class Ox < Formula
  desc "Run AI coding agents in isolated sandboxes"
  homepage "https://ox.build"
  version "${version}"
  license "Apache-2.0"
${platformBlocks}
  def install
    binary = Dir.glob("ox-*").first
    # Downloaded raw binaries don't have the execute bit set.
    chmod 0755, binary
    if OS.mac?
      system "/usr/bin/xattr", "-cr", binary
    end
    bin.install binary => "ox"

    generate_completions_from_executable(bin/"ox", "complete")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ox --version")
  end
end
`;
}

// --- Main ---

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'binaries-dir': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

const version = values.version;
const binariesDir = values['binaries-dir'];
const dryRun = values['dry-run'] ?? false;

if (!version) fail('--version is required');
if (!binariesDir) fail('--binaries-dir is required');

const token = process.env.HOMEBREW_TAP_GITHUB_TOKEN;
if (!token && !dryRun) {
  fail('HOMEBREW_TAP_GITHUB_TOKEN env var is required (or use --dry-run)');
}

const resolvedBinDir = resolve(binariesDir);

console.log(
  `Updating Homebrew formula for ox ${version}${dryRun ? ' (dry-run)' : ''}`,
);
console.log(`  Binaries: ${resolvedBinDir}`);
console.log();

// Compute SHA256 hashes
console.log('Computing SHA256 hashes...');
const hashes = new Map<string, string>();
for (const target of PLATFORMS) {
  const filePath = join(resolvedBinDir, target.binaryName);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    fail(`Binary not found: ${filePath}`);
  }
  const hash = await sha256(filePath);
  hashes.set(target.binaryName, hash);
  console.log(`  ${target.binaryName}: ${hash}`);
}
console.log();

// Generate formula
const formula = generateFormula(version, hashes);
console.log('Generated formula:');
console.log(formula);

if (dryRun) {
  console.log('Dry run — not pushing to tap repo.');
  process.exit(0);
}

// Clone tap repo, update formula, push
const tmpDir = join(
  process.env.RUNNER_TEMP || (await import('node:os')).tmpdir(),
  `ox-brew-${Date.now()}`,
);

const cloneUrl = `https://x-access-token:${token}@github.com/${TAP_REPO}.git`;
console.log(`Cloning ${TAP_REPO}...`);
await run(['git', 'clone', '--depth', '1', cloneUrl, tmpDir]);

// Write formula
const formulaPath = join(tmpDir, FORMULA_FILE);
await Bun.write(formulaPath, formula);

// Configure git for the commit
await run(['git', 'config', 'user.name', 'github-actions[bot]'], {
  cwd: tmpDir,
});
await run(
  [
    'git',
    'config',
    'user.email',
    'github-actions[bot]@users.noreply.github.com',
  ],
  { cwd: tmpDir },
);

// Commit and push
await run(['git', 'add', FORMULA_FILE], { cwd: tmpDir });

const { stdout: diff } = await run(['git', 'diff', '--cached', '--name-only'], {
  cwd: tmpDir,
});
if (!diff) {
  console.log('No changes to formula — skipping push.');
  process.exit(0);
}

await run(['git', 'commit', '-m', `ox ${version}`], { cwd: tmpDir });
await run(['git', 'push'], { cwd: tmpDir });

console.log(`Successfully updated ${TAP_REPO}/${FORMULA_FILE} to ${version}.`);
