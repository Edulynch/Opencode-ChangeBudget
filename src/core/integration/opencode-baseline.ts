import { spawnSync } from 'node:child_process';

import { MANAGED_RESOURCES } from './opencode-types.js';

/** Return an informational warning when managed resources have Git changes. */
export async function checkGitBaseline(projectRoot: string): Promise<string | null> {
  const result = spawnSync(
    'git',
    [
      'status',
      '--porcelain',
      '--',
      MANAGED_RESOURCES.pluginWrapper,
      MANAGED_RESOURCES.instructions,
      MANAGED_RESOURCES.opencodeConfig,
    ],
    { cwd: projectRoot, encoding: 'utf8' },
  );

  if (result.status !== 0) return null;

  const stdout = (result.stdout ?? '').toString();
  if (stdout.trim().length === 0) return null;

  return 'Integration installed. Commit/baseline the OpenCode integration files before starting a ChangeBudget contract.';
}
