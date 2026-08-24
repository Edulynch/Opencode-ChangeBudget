import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHANGEBUDGET_DIR } from '../state/state.js';
import { GitEnvironmentError, GitOutputError } from '../../models/errors.js';
import { compareCodeUnits } from '../ordering.js';
import { projectBaselineChanges, type CurrentBaselineValue } from '../baseline/compare.js';
import type { BaselineEntry, BaselineEvidence } from '../baseline/types.js';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface BudgetChangeItem {
  path: string;
  sourcePath?: string;
  destinationPath?: string;
  type: ChangeType;
  addedLines: number;
  removedLines: number;
  isBinary: boolean;
  staged: boolean;
}

export interface ParsedStatusRecord {
  type: ChangeType;
  path: string;
  sourcePath?: string;
  destinationPath?: string;
}

export interface ParsedNumstatRecord {
  path: string;
  sourcePath?: string;
  destinationPath?: string;
  added: number;
  removed: number;
  isBinary: boolean;
}

export interface NumstatLookupResult {
  byPath: Map<string, ParsedNumstatRecord>;
  byRenameDestination: Map<string, ParsedNumstatRecord>;
  byRenameSource: Map<string, ParsedNumstatRecord>;
}

const NUMSTAT_RECORD_PATTERN = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/;
const NAME_STATUS_ORDINARY_PATTERN = /^[A-Z]$/;
const NAME_STATUS_RENAME_PATTERN = /^[RC]\d*$/;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
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

function truncateExcerpt(value: string): string {
  const sanitized = value.replace(/[\0\r\n]/g, ' ').trim();
  if (sanitized.length <= 80) {
    return sanitized;
  }

  return `${sanitized.slice(0, 77)}...`;
}

export function parseNameStatusZOutput(output: string): ParsedStatusRecord[] {
  const records: ParsedStatusRecord[] = [];
  const chunks = output.split('\0');

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? '';
    if (chunk === '') {
      if (index === chunks.length - 1) {
        continue;
      }

      throw new GitOutputError('Malformed git name-status output: unexpected empty record', {
        recordIndex: index,
      });
    }

    if (NAME_STATUS_RENAME_PATTERN.test(chunk)) {
      const sourcePathChunk = chunks[index + 1];
      const destinationPathChunk = chunks[index + 2];
      if (
        sourcePathChunk === undefined
        || destinationPathChunk === undefined
        || sourcePathChunk === ''
        || destinationPathChunk === ''
      ) {
        throw new GitOutputError('Malformed git name-status rename record: missing source or destination path', {
          recordIndex: index,
          excerpt: truncateExcerpt(chunk),
        });
      }

      const sourcePath = normalizePath(sourcePathChunk);
      const destinationPath = normalizePath(destinationPathChunk);
      if (isToolMetadataPath(sourcePath) || isToolMetadataPath(destinationPath)) {
        index += 2;
        continue;
      }

      records.push({
        type: 'renamed',
        path: destinationPath,
        sourcePath,
        destinationPath,
      });
      index += 2;
      continue;
    }

    if (NAME_STATUS_ORDINARY_PATTERN.test(chunk)) {
      const pathChunk = chunks[index + 1];
      if (pathChunk === undefined || pathChunk === '') {
        throw new GitOutputError('Malformed git name-status record: missing path', {
          recordIndex: index,
          excerpt: truncateExcerpt(chunk),
        });
      }

      const path = normalizePath(pathChunk);
      if (isToolMetadataPath(path)) {
        index += 1;
        continue;
      }

      records.push({
        type: parseStatusType(chunk),
        path,
      });
      index += 1;
      continue;
    }

    throw new GitOutputError('Malformed git name-status record', {
      recordIndex: index,
      excerpt: truncateExcerpt(chunk),
    });
  }

  return records;
}

export function parseNumstatZOutput(output: string): NumstatLookupResult {
  const byPath = new Map<string, ParsedNumstatRecord>();
  const byRenameDestination = new Map<string, ParsedNumstatRecord>();
  const byRenameSource = new Map<string, ParsedNumstatRecord>();

  const chunks = output.split('\0');

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? '';
    if (chunk === '') {
      if (index === chunks.length - 1) {
        continue;
      }

      throw new GitOutputError('Malformed git numstat output: unexpected empty record', {
        recordIndex: index,
      });
    }

    const match = NUMSTAT_RECORD_PATTERN.exec(chunk);
    if (!match) {
      throw new GitOutputError('Malformed git numstat record', {
        recordIndex: index,
        excerpt: truncateExcerpt(chunk),
      });
    }

    const addedText = match[1]!;
    const removedText = match[2]!;
    const pathText = match[3]!;

    const isBinary = addedText === '-' || removedText === '-';
    const added = isBinary ? 0 : Number(addedText);
    const removed = isBinary ? 0 : Number(removedText);

    if (Number.isNaN(added) || Number.isNaN(removed)) {
      throw new GitOutputError('Malformed git numstat record: non-numeric line counts', {
        recordIndex: index,
        excerpt: truncateExcerpt(chunk),
      });
    }

    if (pathText === '') {
      const sourcePathChunk = chunks[index + 1];
      const destinationPathChunk = chunks[index + 2];
      if (
        sourcePathChunk === undefined
        || destinationPathChunk === undefined
        || sourcePathChunk === ''
        || destinationPathChunk === ''
      ) {
        throw new GitOutputError('Malformed git numstat rename record: missing source or destination path', {
          recordIndex: index,
          excerpt: truncateExcerpt(chunk),
        });
      }

      const sourcePath = normalizePath(sourcePathChunk);
      const destinationPath = normalizePath(destinationPathChunk);
      if (isToolMetadataPath(sourcePath) || isToolMetadataPath(destinationPath)) {
        index += 2;
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
      index += 2;
      continue;
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
  target.staged = target.staged || source.staged;

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
      staged: false,
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
        staged: false,
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

function applyStagedMembership(
  stagedRecords: ParsedStatusRecord[],
  results: Map<string, BudgetChangeItem>,
): void {
  for (const record of stagedRecords) {
    const existing = results.get(normalizePath(record.path));
    if (existing) {
      existing.staged = true;
    }

    if (record.type === 'renamed' && record.sourcePath) {
      const sourceExisting = results.get(normalizePath(record.sourcePath));
      if (sourceExisting) {
        sourceExisting.staged = true;
      }
    }
  }
}

function runGitRaw(
  repositoryRoot: string,
  args: string[],
  allowedExitCodes?: readonly number[],
): Promise<string> {
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
      const normalizedCode = code ?? -1;
      if (allowedExitCodes ? !allowedExitCodes.includes(normalizedCode) : normalizedCode !== 0) {
        reject(
          new GitEnvironmentError(
            `Git command failed with exit code ${normalizedCode}`,
            {
              args,
              repositoryRoot,
              exitCode: normalizedCode,
              stderr: stderr.trim(),
            },
          ),
        );
        return;
      }

      resolve(stdout);
    });
  });
}

async function detectUntrackedBinary(repositoryRoot: string, path: string): Promise<boolean> {
  const sentinelRoot = await mkdtemp(join(tmpdir(), 'cb-changebudget-sentinel-'));
  const sentinelPath = join(sentinelRoot, 'empty');

  try {
    await writeFile(sentinelPath, Buffer.alloc(0));

    const output = await runGitRaw(
      repositoryRoot,
      ['diff', '-z', '--numstat', '--no-index', '--', sentinelPath, path],
      [0, 1],
    );
    const firstChunk = output.split('\0')[0] ?? '';
    const columns = firstChunk.split('\t');
    if (columns.length < 2) {
      return false;
    }

    return columns[0] === '-' || columns[1] === '-';
  } finally {
    await rm(sentinelRoot, { recursive: true, force: true });
  }
}

export async function collectChangedItems(repositoryRoot: string, baseRevision: string): Promise<BudgetChangeItem[]> {
  const canonicalNameStatus = runGitRaw(repositoryRoot, ['diff', '-z', '--name-status', '--find-renames', baseRevision, '--']);
  const canonicalNumstat = runGitRaw(repositoryRoot, ['diff', '-z', '--numstat', '--find-renames', baseRevision, '--']);
  const stagedNameStatus = runGitRaw(repositoryRoot, ['diff', '--cached', '-z', '--name-status', '--find-renames', baseRevision, '--']);
  const untracked = runGitRaw(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z', '--']);

  const [canonicalNameStatusOutput, canonicalNumstatOutput, stagedNameStatusOutput, untrackedOutput] = await Promise.all([
    canonicalNameStatus,
    canonicalNumstat,
    stagedNameStatus,
    untracked,
  ]);

  const canonicalRecords = parseNameStatusZOutput(canonicalNameStatusOutput);
  const canonicalLookup = parseNumstatZOutput(canonicalNumstatOutput);
  const stagedRecords = parseNameStatusZOutput(stagedNameStatusOutput);

  const changeMap = new Map<string, BudgetChangeItem>();

  applyNumstatRecords(canonicalRecords, canonicalLookup, changeMap);
  applyStagedMembership(stagedRecords, changeMap);

  const untrackedPaths = untrackedOutput
    .split('\0')
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
      staged: false,
    });
  }

  const sorted = Array.from(changeMap.values()).sort((left, right) => compareCodeUnits(left.path, right.path));
  return sorted;
}

async function readCurrentBaselineValue(
  repositoryRoot: string,
  entry: BaselineEntry,
): Promise<CurrentBaselineValue | null> {
  try {
    const target = join(repositoryRoot, entry.path);
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      return { bytes: Buffer.from(await readlink(target)), objectType: 'symlink', mode: '120000' };
    }
    if (!stat.isFile()) return { bytes: Buffer.alloc(0), objectType: 'other', mode: null };
    return {
      bytes: await readFile(target),
      objectType: 'file',
      mode: entry.mode === null ? null : (stat.mode & 0o111) === 0 ? '100644' : '100755',
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function collectBaselineChangedItems(
  repositoryRoot: string,
  evidence: BaselineEvidence,
): Promise<ReturnType<typeof projectBaselineChanges>> {
  const currentItems = await collectChangedItems(repositoryRoot, evidence.activationHead);
  const values = await Promise.all(evidence.entries.map(async (entry) => [
    entry.path,
    await readCurrentBaselineValue(repositoryRoot, entry),
  ] as const));
  return projectBaselineChanges(evidence, currentItems, new Map(values));
}
