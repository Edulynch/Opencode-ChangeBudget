import { comparisonModeForContract } from '../../models/change-contract.js';
import type { ChangeContract } from '../../models/change-contract.js';
import { IOStateError, StateCorruptionError } from '../../models/errors.js';
import { runGit } from '../git/repo.js';
import { readBaselineEvidence } from '../state/state.js';
import { validateBaselineEvidence } from './validation.js';
import type { BaselineEvidence, BaselineReasonCode, BaselineState, ComparisonMode } from './types.js';

export type ReloadedBaseline =
  | { readonly kind: 'legacy'; readonly comparisonMode: ComparisonMode; readonly baselineState: BaselineState }
  | { readonly kind: 'ready'; readonly comparisonMode: 'baseline'; readonly baselineState: 'captured'; readonly evidence: BaselineEvidence }
  | { readonly kind: 'unsafe'; readonly comparisonMode: 'baseline'; readonly baselineState: Exclude<BaselineState, 'legacy' | 'captured'>; readonly reasonCodes: readonly BaselineReasonCode[] };

function unsafe(
  baselineState: Exclude<BaselineState, 'legacy' | 'captured'>,
  reasonCode: BaselineReasonCode,
): ReloadedBaseline {
  return { kind: 'unsafe', comparisonMode: 'baseline', baselineState, reasonCodes: [reasonCode] };
}

export async function reloadBaselineEvidence(
  repositoryRoot: string,
  contract: ChangeContract,
): Promise<ReloadedBaseline> {
  if (comparisonModeForContract(contract) === 'legacy') {
    return { kind: 'legacy', comparisonMode: 'legacy', baselineState: 'legacy' };
  }

  if (!contract.baseline_ref || !contract.activation_head) {
    return unsafe('unavailable', 'BASELINE_REQUIRED_MISSING');
  }

  let evidence: BaselineEvidence | null;
  try {
    evidence = await readBaselineEvidence(repositoryRoot, contract.id);
  } catch (error) {
    if (error instanceof IOStateError || error instanceof StateCorruptionError) {
      return unsafe('invalid', 'BASELINE_CORRUPT');
    }
    throw error;
  }
  if (evidence === null) return unsafe('unavailable', 'BASELINE_REQUIRED_MISSING');

  const validation = validateBaselineEvidence(contract, evidence, {
    repositoryCase: process.platform === 'win32' ? 'insensitive' : 'sensitive',
    platformCase: process.platform === 'win32' ? 'insensitive' : 'sensitive',
  });
  if (validation.decision !== 'PASS') {
    const baselineState = validation.baselineState === 'captured' ? 'invalid' : validation.baselineState;
    return unsafe(baselineState, validation.reasonCodes[0] ?? 'BASELINE_CORRUPT');
  }

  const currentHead = await runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  if (currentHead !== contract.activation_head) return unsafe('invalid', 'BASELINE_HEAD_MOVED');

  return { kind: 'ready', comparisonMode: 'baseline', baselineState: 'captured', evidence };
}
