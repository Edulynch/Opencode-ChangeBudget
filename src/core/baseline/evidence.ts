import type { BaselineObservation } from './types.js';

export type SelectedEvidence =
  | { readonly kind: 'git'; readonly reference: string }
  | { readonly kind: 'private'; readonly payload: string };

export function selectEvidence(
  observation: BaselineObservation,
  gitReference: string | null,
  privatePayload: string | null,
): SelectedEvidence | null {
  if (gitReference !== null && !observation.unstaged && !observation.untracked) {
    return { kind: 'git', reference: gitReference };
  }
  if (privatePayload !== null) return { kind: 'private', payload: privatePayload };
  return null;
}
