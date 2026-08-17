import { spawn } from 'node:child_process';

import { GitEnvironmentError } from '../../models/errors.js';

export function runGit(repositoryRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(
        new GitEnvironmentError('Unable to execute git command', {
          args,
          repositoryRoot,
          cause: error.message,
        }),
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new GitEnvironmentError(
            `Git command failed with exit code ${code}`,
            {
              args,
              repositoryRoot,
              exitCode: code,
              stderr: stderr.trim(),
            },
          ),
        );
        return;
      }

      resolve(stdout.trim());
    });
  });
}

export async function getRepositoryRoot(repositoryRootHint: string): Promise<string> {
  const output = await runGit(repositoryRootHint, ['rev-parse', '--show-toplevel']);
  if (!output) {
    throw new GitEnvironmentError('Git repository root is not available', {
      repositoryRootHint,
    });
  }

  return output;
}

export async function isGitRepository(repositoryRootHint: string): Promise<boolean> {
  try {
    const output = await runGit(repositoryRootHint, ['rev-parse', '--is-inside-work-tree']);
    return output.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export async function ensureGitRepository(repositoryRootHint: string): Promise<string> {
  if (!(await isGitRepository(repositoryRootHint))) {
    throw new GitEnvironmentError('Current directory is not a Git repository', {
      repositoryRootHint,
    });
  }

  return getRepositoryRoot(repositoryRootHint);
}

export async function validateRevision(
  repositoryRoot: string,
  revision: string,
): Promise<boolean> {
  const normalizedRevision = revision.trim();

  if (!normalizedRevision) {
    return false;
  }

  try {
    await runGit(repositoryRoot, ['rev-parse', '--verify', '--quiet', `${normalizedRevision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
