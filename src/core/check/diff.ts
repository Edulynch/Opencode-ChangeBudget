import { spawn } from 'node:child_process';

import { runGit } from '../git/repo.js';
import { CHANGEBUDGET_DIR } from '../state/state.js';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface BudgetChangeItem {
  path: string;
  sourcePath?: string;
  destinationPath?: string;
  type: ChangeType;
  addedLines: number;
  removedLines: number;
  isBinary: boolean;
}

interface ParsedStatusRecord {
  type: ChangeType;
  path: string;
  sourcePath?: string;
  destinationPath?: string;
}

interface ParsedNumstatRecord {
  path: string;
  sourcePath?: string;
  destinationPath?: string;
  added: number;
  removed: number;
  isBinary: boolean;
}

interface NumstatLookupResult {
  byPath: Map<string, ParsedNumstatRecord>;
  byRenameDestination: Map<string, ParsedNumstatRecord>;
  byRenameSource: Map<string, ParsedNumstatRecord>;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isToolMetadataPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized) {
    return false;
  }

  return normalized === CHANGEBUDGET_DIR || normalized.startsWith(`${CHANGEBUDGET_DIR}/`);
}

function parseStatusType(rawStatus: string): 'renamed' | 'deleted' | 'added' | 'modified' {
  const status = rawStatus[0];
  if (status === 'R' || status === 'C') {
    return 'renamed';
  }

  if (status === 'D') {
    return 'deleted';
  }

  if (status === 'A') {
    return 'added';
  }

  return 'modified';
}

function parseNameStatusOutput(output: string): ParsedStatusRecord[] {
  const lines = output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const records: ParsedStatusRecord[] = [];

  for (const line of lines) {
    const parts = line.split('\t');
    if (!parts.length) {
      continue;
    }

    const rawStatus = parts[0] ?? '';
    const type = parseStatusType(rawStatus);
    if (type === 'renamed') {
      if (parts.length < 3) {
        continue;
      }

      const sourcePath = normalizePath(parts[1] ?? '');
      const destinationPath = normalizePath(parts[2] ?? '');
      if (isToolMetadataPath(sourcePath) || isToolMetadataPath(destinationPath)) {
        continue;
      }

      records.push({
        type,
        path: destinationPath,
        sourcePath,
        destinationPath,
      });
      continue;
    }

    if (parts.length < 2) {
      continue;
    }

    const path = normalizePath(parts[1] ?? '');
    if (isToolMetadataPath(path)) {
      continue;
    }

    records.push({
      type,
      path,
    });
  }

  return records;
}

function parseNumstatOutput(output: string): NumstatLookupResult {
  const byPath = new Map<string, ParsedNumstatRecord>();
  const byRenameDestination = new Map<string, ParsedNumstatRecord>();
  const byRenameSource = new Map<string, ParsedNumstatRecord>();

  const lines = output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

  for (const line of lines) {
    const firstSplit = line.split('\t');
    if (firstSplit.length < 3) {
      continue;
    }

    const addedText = firstSplit[0];
    const removedText = firstSplit[1];
    const pathText = firstSplit.slice(2).join('\t');

    const isBinary = addedText === '-' || removedText === '-';
    const added = isBinary ? 0 : Number(addedText);
    const removed = isBinary ? 0 : Number(removedText);

    if (Number.isNaN(added) || Number.isNaN(removed)) {
      continue;
    }

    if (pathText.includes(' => ')) {
      const pair = pathText.split(' => ');
      if (pair.length === 2) {
        const sourcePath = normalizePath(pair[0]!.trim());
        const destinationPath = normalizePath(pair[1]!.trim());
        if (isToolMetadataPath(sourcePath) || isToolMetadataPath(destinationPath)) {
          continue;
        }

        const record: ParsedNumstatRecord = {
          path: destinationPath,
          sourcePath,
          destinationPath,
          added,
          removed,
          isBinary,
        };

        byRenameDestination.set(destinationPath, record);
        byRenameSource.set(sourcePath, record);
        continue;
      }
    }

    const path = normalizePath(pathText);
    if (isToolMetadataPath(path)) {
      continue;
    }

    byPath.set(path, {
      path,
      added,
      removed,
      isBinary,
    });
  }

  return { byPath, byRenameDestination, byRenameSource };
}

function mergeItem(target: BudgetChangeItem, source: Omit<BudgetChangeItem, 'path'>): void {
  target.addedLines += source.addedLines;
  target.removedLines += source.removedLines;
  target.isBinary = target.isBinary || source.isBinary;

  if (source.type === 'renamed') {
    target.type = 'renamed';
  }

  if (!target.sourcePath && source.sourcePath) {
    target.sourcePath = source.sourcePath;
  }

  if (!target.destinationPath && source.destinationPath) {
    target.destinationPath = source.destinationPath;
  }
}

function applyNumstatRecords(
  records: ParsedStatusRecord[],
  lookup: NumstatLookupResult,
  results: Map<string, BudgetChangeItem>,
): void {
  for (const record of records) {
    const normalizedPath = normalizePath(record.path);
    if (!normalizedPath) {
      continue;
    }

    const renameSource = record.type === 'renamed' ? record.sourcePath : undefined;
    const renameDestination = record.type === 'renamed' ? record.destinationPath : undefined;

    const sourceRecord = renameDestination
      ? lookup.byRenameDestination.get(renameDestination)
      : lookup.byPath.get(normalizedPath);

    const pathRecord: BudgetChangeItem = {
      path: normalizedPath,
      type: record.type,
      sourcePath: record.sourcePath,
      destinationPath: record.destinationPath,
      addedLines: sourceRecord ? sourceRecord.added : 0,
      removedLines: sourceRecord ? sourceRecord.removed : 0,
      isBinary: sourceRecord ? sourceRecord.isBinary : false,
    };

    const existing = results.get(normalizedPath);
    if (existing) {
      mergeItem(existing, pathRecord);
    } else {
      results.set(normalizedPath, pathRecord);
    }

    if (record.type === 'renamed' && renameSource) {
      const sourceStats = lookup.byRenameSource.get(renameSource);
      const sourceRecordForAlias: BudgetChangeItem = {
        path: renameSource,
        type: 'deleted',
        addedLines: sourceStats ? sourceStats.added : 0,
        removedLines: sourceStats ? sourceStats.removed : 0,
        isBinary: sourceStats ? sourceStats.isBinary : false,
      };

      const sourceExisting = results.get(renameSource);
      if (sourceExisting) {
        mergeItem(sourceExisting, sourceRecordForAlias);
      } else {
        results.set(renameSource, sourceRecordForAlias);
      }
    }
  }
}

function runGitWithAllowedExit(repositoryRoot: string, args: string[], allowedCodes: number[]): Promise<string> {
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
      reject(error);
    });

    child.on('close', (code) => {
      const normalizedCode = code ?? -1;
      if (!allowedCodes.includes(normalizedCode)) {
        reject(new Error(`Git command failed with exit code ${normalizedCode}`));
        return;
      }

      if (stdout) {
        resolve(stdout.trim());
        return;
      }

      if (stderr && normalizedCode !== 0) {
        reject(new Error(stderr.trim()));
        return;
      }

      resolve('');
    });
  });
}

async function detectUntrackedBinary(repositoryRoot: string, path: string): Promise<boolean> {
  try {
    const output = await runGitWithAllowedExit(
      repositoryRoot,
      ['diff', '--numstat', '--no-index', '--', '/dev/null', path],
      [0, 1],
    );
    const firstLine = output.split('\n')[0]?.trim();
    if (!firstLine) {
      return false;
    }

    const parts = firstLine.split('\t');
    if (parts.length < 2) {
      return false;
    }

    return parts[0] === '-' || parts[1] === '-';
  } catch {
    return false;
  }
}

export async function collectChangedItems(repositoryRoot: string, baseRevision: string): Promise<BudgetChangeItem[]> {
  const stagedNameStatus = runGit(repositoryRoot, ['diff', '--cached', '--name-status', '--find-renames', baseRevision, '--']);
  const stagedNumstat = runGit(repositoryRoot, ['diff', '--cached', '--numstat', '--find-renames', baseRevision, '--']);
  const unstagedNameStatus = runGit(repositoryRoot, ['diff', '--name-status', '--find-renames', baseRevision, '--']);
  const unstagedNumstat = runGit(repositoryRoot, ['diff', '--numstat', '--find-renames', baseRevision, '--']);
  const untracked = runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '--']);

  const outputs = await Promise.all([stagedNameStatus, stagedNumstat, unstagedNameStatus, unstagedNumstat, untracked]);

  const [stagedNameStatusOutput, stagedNumstatOutput, unstagedNameStatusOutput, unstagedNumstatOutput, untrackedOutput] = outputs;

  const stagedRecords = parseNameStatusOutput(stagedNameStatusOutput);
  const unstagedRecords = parseNameStatusOutput(unstagedNameStatusOutput);

  const stagedNumstatRecords = parseNumstatOutput(stagedNumstatOutput);
  const unstagedNumstatRecords = parseNumstatOutput(unstagedNumstatOutput);

  const changeMap = new Map<string, BudgetChangeItem>();

  applyNumstatRecords(stagedRecords, stagedNumstatRecords, changeMap);
  applyNumstatRecords(unstagedRecords, unstagedNumstatRecords, changeMap);

  const untrackedPaths = untrackedOutput
    .split('\n')
    .map((entry) => normalizePath(entry));

  for (const path of untrackedPaths) {
    if (!path) {
      continue;
    }
    if (isToolMetadataPath(path)) {
      continue;
    }

    const existing = changeMap.get(path);
    if (existing) {
      if (existing.type === 'deleted') {
        existing.type = 'added';
      }

      const isBinary = await detectUntrackedBinary(repositoryRoot, path);
      existing.isBinary = existing.isBinary || isBinary;
      continue;
    }

    const isBinary = await detectUntrackedBinary(repositoryRoot, path);

    changeMap.set(path, {
      path,
      type: 'added',
      addedLines: 0,
      removedLines: 0,
      isBinary,
    });
  }

  const sorted = Array.from(changeMap.values()).sort((left, right) => left.path.localeCompare(right.path));
  return sorted;
}
