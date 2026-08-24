import { createHash } from 'node:crypto';

import type { BaselineEntry, BaselineEvidence } from './types.js';

export interface EvidenceDescriptorInput {
  readonly schemaVersion: number;
  readonly contractId: string;
  readonly activationHead: string;
  readonly entries: readonly BaselineEntry[];
}

export interface EvidenceVerification {
  readonly evidenceState: 'valid' | 'corrupt';
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function digest(input: EvidenceDescriptorInput): string {
  return createHash('sha256').update(JSON.stringify(stableValue(input))).digest('hex');
}

export function digestContent(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createEvidenceDescriptor(input: EvidenceDescriptorInput): BaselineEvidence {
  return { ...input, integrity: digest(input) };
}

export function verifyEvidenceDescriptor(evidence: BaselineEvidence): EvidenceVerification {
  const { integrity: _integrity, ...input } = evidence;
  return { evidenceState: digest(input) === evidence.integrity ? 'valid' : 'corrupt' };
}
