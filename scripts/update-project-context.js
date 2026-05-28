#!/usr/bin/env node
/**
 * update-project-context.js
 *
 * PostToolUse hook — runs after every Bash tool call in Claude Code.
 * Detects git commits and refreshes PROJECT_CONTEXT.md with:
 *   - Latest 10 commits in the Recent Changes table
 *   - Harness task status based on which files exist
 *   - Updated timestamp
 *
 * Invoked by .claude/settings.json PostToolUse hook.
 * Receives the tool event as JSON on stdin.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read stdin (hook payload)
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input || '{}');
    const cmd = event?.tool_input?.command ?? '';

    // Only update on git commits
    if (!cmd.includes('git commit')) {
      process.exit(0);
    }

    updateProjectContext();
  } catch {
    // Non-JSON input or other error — silently exit
    process.exit(0);
  }
});

function updateProjectContext() {
  const repoRoot = path.resolve(__dirname, '..');
  const contextFile = path.join(repoRoot, 'PROJECT_CONTEXT.md');

  if (!fs.existsSync(contextFile)) {
    process.exit(0);
  }

  // --- Recent Changes ---
  let recentChanges = '| Date | Commit | Description |\n|------|--------|-------------|\n';
  try {
    const log = execSync(
      'git log --pretty=format:"%ad|%h|%s" --date=format:"%Y-%m-%d" -10',
      { cwd: repoRoot, encoding: 'utf8' }
    );
    for (const line of log.trim().split('\n')) {
      if (!line.trim()) continue;
      const [date, hash, ...msgParts] = line.split('|');
      const msg = msgParts.join('|').slice(0, 80);
      recentChanges += `| ${date} | \`${hash}\` | ${msg} |\n`;
    }
  } catch {
    recentChanges += '| — | — | Unable to read git log |\n';
  }

  // --- Harness Task Status ---
  const harnessDir = path.join(repoRoot, 'src/lib/agent/harness');
  const harnessExists = fs.existsSync(harnessDir);

  function fileStatus(filename) {
    if (!harnessExists) return 'Pending';
    return fs.existsSync(path.join(harnessDir, filename)) ? 'Done' : 'Pending';
  }

  // Check AgentLoop for harness wiring (look for ContextEngine import)
  const agentLoopPath = path.join(repoRoot, 'src/lib/agent/AgentLoop.ts');
  let agentLoopWired = false;
  if (fs.existsSync(agentLoopPath)) {
    const content = fs.readFileSync(agentLoopPath, 'utf8');
    agentLoopWired = content.includes('ContextEngine') || content.includes('HarnessLifecycle');
  }

  // Check for UI components
  const impactPanelExists = fs.existsSync(path.join(repoRoot, 'src/components/ImpactMapPanel.tsx'));
  const dashboardExists = fs.existsSync(path.join(repoRoot, 'src/components/admin/HarnessDashboard.tsx'));

  const harnessTable =
    '| Task | Description | Status |\n' +
    '|------|-------------|--------|\n' +
    `| H-1 | ContextEngine — history compaction + token badge | ${fileStatus('ContextEngine.ts')} |\n` +
    `| H-2 | HarnessLifecycle — hooks + struggle detection | ${fileStatus('HarnessLifecycle.ts')} |\n` +
    `| H-3 | ImpactMapEngine + ImpactMapPanel | ${fileStatus('ImpactMapEngine.ts') === 'Done' && impactPanelExists ? 'Done' : fileStatus('ImpactMapEngine.ts') === 'Done' ? 'Partial' : 'Pending'} |\n` +
    `| H-4 | FailureTraceStore + HarnessOptimizer + Dashboard | ${fileStatus('FailureTraceStore.ts') === 'Done' && fileStatus('HarnessOptimizer.ts') === 'Done' ? dashboardExists ? 'Done' : 'Partial' : 'Pending'} |\n` +
    `| H-5 | PolicyEngine — 4 built-in policies | ${fileStatus('PolicyEngine.ts')} |\n` +
    `| H-6 | HarnessObserver — session telemetry | ${fileStatus('HarnessObserver.ts')} |\n` +
    `| Wire | AgentLoop integration (Tasks 6, 8, 10, 13) | ${agentLoopWired ? 'In Progress' : 'Pending'} |\n` +
    `| UI | HarnessDashboard + ImpactMapPanel | ${dashboardExists || impactPanelExists ? 'In Progress' : 'Pending'} |\n`;

  // --- Timestamp ---
  const today = new Date().toISOString().slice(0, 10);

  // --- Patch the file ---
  let content = fs.readFileSync(contextFile, 'utf8');

  // Replace Recent Changes section
  content = content.replace(
    /## Recent Changes\n[\s\S]*?(?=\n## |\n---)/,
    `## Recent Changes\n\n${recentChanges}`
  );

  // Replace Harness Tasks Progress table
  content = content.replace(
    /### Harness Tasks Progress\n\n[\s\S]*?(?=\n>|\n##)/,
    `### Harness Tasks Progress\n\n${harnessTable}`
  );

  // Replace "Last updated" line
  content = content.replace(
    /\*Last updated:.*\*/,
    `*Last updated: ${today} — Updated automatically by Claude Code hook after each commit.*`
  );

  fs.writeFileSync(contextFile, content, 'utf8');

  // Stage and amend the last commit — no, instead just stage it for next commit.
  // We don't want to silently amend user commits. Instead, just update the file
  // and let the user see it as a pending change.
  //
  // Alternative: auto-commit the context update as a separate commit.
  try {
    execSync('git add PROJECT_CONTEXT.md', { cwd: repoRoot });
    execSync(
      `git commit -m "docs: auto-update PROJECT_CONTEXT.md [skip ci]"`,
      { cwd: repoRoot }
    );
  } catch {
    // If commit fails (nothing to commit, etc.) that's fine
  }
}
