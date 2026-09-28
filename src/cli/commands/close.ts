import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import type { LifecycleAuditRecord } from '../../models/lifecycle-state.js';
import { StateConflictError, StateCorruptionError } from '../../models/errors.js';
import { ChangeContract } from '../../models/change-contract.js';
import {
  createLifecycleAuditRecord,
  recoverPendingLifecycleAudits,
  withContractFileLock,
  withLifecycleStateLock,
} from '../../core/state/state.js';
import { assertActiveContractCoherent, closeContractInPlace, readContract } from '../../core/state/contracts.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { transitionToClosed } from '../../core/state/transitions.js';
import { InputValidationError } from '../../models/errors.js';

export interface CloseResult {
  repositoryRoot: string;
  contractId: string;
  state: LifecycleStateRecord;
  contract: ChangeContract;
}

interface CloseOptions {
  actor?: string;
  reason?: string;
  force: boolean;
}

function parseNextValue(args: string[], index: number): { value: string; nextIndex: number } {
  if (index + 1 >= args.length) {
    throw new InputValidationError('Missing value for option', 'option');
  }

  const value = args[index + 1];
  if (value.startsWith('--')) {
    throw new InputValidationError('Missing value for option', 'option');
  }

  return { value, nextIndex: index + 1 };
}

function parseCloseArgs(args: string[]): CloseOptions {
  let actor: string | undefined;
  let reason: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
    }

    const pair = token.slice(2).split('=', 2);
    const key = pair[0].toLowerCase();
    const inlineValue = pair.length === 2 ? pair[1] : null;

    if (key === 'force') {
      if (inlineValue !== null) {
        throw new InputValidationError('--force does not accept a value', '--force');
      }
      force = true;
      continue;
    }

    if (key === 'actor' || key === 'reason') {
      const value = inlineValue === null ? parseNextValue(args, index).value : inlineValue;
      if (inlineValue === null) {
        index += 1;
      }

      if (key === 'actor') {
        actor = value;
      } else {
        reason = value;
      }
      continue;
    }

    throw new InputValidationError(`Unknown option --${key}`, `--${key}`);
  }

  if (force && (reason === undefined || reason.trim().length === 0)) {
    throw new InputValidationError('--reason is required with --force', '--reason');
  }

  return { actor, reason, force };
}

function assertStateCanClose(state: LifecycleStateRecord | null): LifecycleStateRecord {
  if (!state) {
    throw new StateConflictError('Cannot close contract because lifecycle state is uninitialized.', 'lifecycle_state', {
      current: 'uninitialized',
    });
  }

  if (state.lifecycle_state !== 'active') {
    throw new StateConflictError(
      `Cannot close contract because lifecycle state is ${state.lifecycle_state}.`,
      'lifecycle_state',
      {
        current: state.lifecycle_state,
      },
    );
  }

  if (!state.active_contract_id) {
    throw new StateConflictError('No active contract id is stored in state.', 'active_contract_id', {
      state,
    });
  }

  return state;
}

export async function runClose(repositoryRootHint = process.cwd(), args: string[] = []): Promise<CloseResult> {
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  await recoverPendingLifecycleAudits(repositoryRoot);
  const options = parseCloseArgs(args);
  let result: CloseResult | undefined;

  // Canonical lifecycle order is state lock → contract lock. Audit append,
  // contract write, state pointer update, and terminal audit write stay inside
  // this one state-lock boundary; no state-locking wrapper is called inside it.
  await withLifecycleStateLock(repositoryRoot, async (transaction) => {
    await transaction.assertNoPendingAudits();
    const state = await transaction.readState();

    if (state?.lifecycle_state === 'closed') {
      if (state.active_contract_id !== null || typeof state.last_closed_contract_id !== 'string') {
        throw new StateCorruptionError('Closed lifecycle state has contradictory contract pointers', {
          activeContractId: state.active_contract_id,
          lastClosedContractId: state.last_closed_contract_id,
        });
      }
      const contractId = state.last_closed_contract_id;
      await withContractFileLock(repositoryRoot, contractId, async () => {
        const existing = await readContract(repositoryRoot, contractId);
        if (existing.id !== contractId || existing.status !== 'closed') {
          throw new StateCorruptionError(`Closed lifecycle pointer ${contractId} does not reference a closed contract`, {
            contractId,
            fileContractId: existing.id,
            contractStatus: existing.status,
          });
        }
        const rejected = createLifecycleAuditRecord({
          operation: 'close',
          repositoryRoot,
          lifecycleBefore: 'closed',
          lifecycleAfter: 'closed',
          beforeContract: existing,
          afterContract: existing,
          reasonProvided: options.reason !== undefined,
          actorProvided: options.actor !== undefined,
          forceRequested: options.force,
        });
        await transaction.persistAudit(rejected);
        await transaction.abortAudit(rejected.event_id);
      });
      throw new StateConflictError('Cannot close contract because lifecycle state is already closed.', 'lifecycle_state', {
        current: 'closed',
        lastClosedContractId: contractId,
      });
    }

    const current = assertStateCanClose(state);
    const contractId = current.active_contract_id!;
    const closedAt = new Date().toISOString();
    let auditRecord: LifecycleAuditRecord | undefined;
    const contract = await closeContractInPlace(repositoryRoot, contractId, closedAt, {
      closedBy: options.actor,
      closeReason: options.reason,
      forced: options.force,
    }, async (before, closed) => {
      assertActiveContractCoherent(current, before);
      auditRecord = createLifecycleAuditRecord({
        operation: 'close',
        repositoryRoot,
        lifecycleBefore: current.lifecycle_state,
        lifecycleAfter: 'closed',
        beforeContract: before,
        afterContract: closed,
        reasonProvided: options.reason !== undefined,
        actorProvided: options.actor !== undefined,
        forceRequested: options.force,
      });
      await transaction.persistAudit(auditRecord);
    });

    const nextState = transitionToClosed(current);
    await transaction.writeState(nextState);
    if (auditRecord === undefined) {
      throw new StateConflictError('CLOSE completed without lifecycle audit evidence.', 'lifecycle_state');
    }
    await transaction.completeAudit(auditRecord.event_id);
    const auditedState = await transaction.readState();
    if (auditedState === null || auditedState.lifecycle_state !== 'closed'
      || auditedState.last_closed_contract_id !== contractId) {
      throw new StateConflictError('CLOSE returned without a verifiable closed lifecycle pointer.', 'lifecycle_state');
    }
    result = { repositoryRoot, contractId, state: auditedState, contract };
  });

  if (result === undefined) {
    throw new StateConflictError('CLOSE completed without a verifiable lifecycle result.', 'lifecycle_state');
  }
  return result;
}
