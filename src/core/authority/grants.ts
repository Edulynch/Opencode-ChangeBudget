import { createHash, randomUUID } from 'node:crypto';

import { canonicalizeLiteralPath, isChangeBudgetPath } from '../check/literal-path.js';
import { compilePathPatterns, matchPathPattern } from '../check/patterns.js';

export const GRANT_SCHEMA_VERSION = 1 as const;
const MAX_GRANT_JSON_BYTES = 64 * 1024;
const MAX_COLLECTION_SIZE = 64;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTRACT_ID_PATTERN = /^contract-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const OPERATION_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/u;
const PATH_META_PATTERN = /[*?\[\]]/u;

export type GrantMode = 'REUSABLE' | 'ONE_SHOT';
export type GrantLifecycle = 'ACTIVE' | 'REVOKED' | 'CONSUMED';

export interface GrantCeilings {
  readonly max_files?: number;
  readonly max_changed_lines?: number;
}

export interface GrantPermissions {
  readonly allow_new_files: boolean;
  readonly allow_dependencies: boolean;
  readonly allow_migrations: boolean;
  readonly allow_configuration: boolean;
  readonly allow_public_api: boolean;
}

export interface AuthorityUseRequest {
  readonly grant_reference_id: string;
  readonly requested_operation: string;
  readonly requested_capabilities: readonly string[];
  readonly requested_paths: readonly string[];
  readonly requested_ceilings: Required<GrantCeilings>;
  readonly requested_permissions: GrantPermissions;
}

export interface GrantDraft {
  readonly subject_label?: string;
  readonly operations: readonly string[];
  readonly capabilities: readonly string[];
  readonly path_scope: readonly string[];
  readonly ceilings: GrantCeilings;
  readonly permissions: GrantPermissions;
  readonly mode: GrantMode;
  readonly valid_from: string;
  readonly expires_at: string;
}

export interface GrantBindingContext {
  readonly repository_reference_id: string;
  readonly repository_binding_epoch: number;
  readonly authority_id: string;
  readonly work_id: string;
  readonly work_activation_id: string;
  readonly work_activation_epoch: number;
  readonly subject_id: string;
  readonly subject_label: string | null;
  readonly contract_id: string | null;
  readonly task_id: string | null;
  readonly contract_revision_digest: string;
  readonly scope_digest: string;
  readonly authority_revision: number;
}

export interface CanonicalGrantRecord extends GrantBindingContext {
  readonly grant_schema_version: typeof GRANT_SCHEMA_VERSION;
  readonly grant_id: string;
  readonly operations: readonly string[];
  readonly capabilities: readonly string[];
  readonly path_scope: readonly string[];
  readonly ceilings: GrantCeilings;
  readonly permissions: GrantPermissions;
  readonly mode: GrantMode;
  readonly valid_from: string;
  readonly expires_at: string;
  readonly issuer: {
    readonly kind: 'CHANGE_BUDGET_DIRECT_ADMIN';
    readonly execution_boundary: 'OUTSIDE_GOVERNED_RUNTIME';
    readonly audit_correlation_id: string;
  };
  readonly created_at: string;
  readonly grant_digest: string;
}

export class GrantValidationError extends Error {
  readonly code: 'INVALID_DRAFT' | 'INVALID_GRANT' | 'DUPLICATE_FIELD' | 'DIGEST_MISMATCH';

  constructor(
    code: GrantValidationError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GrantValidationError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...required, ...optional].sort();
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !allowed.includes(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new GrantValidationError('INVALID_DRAFT', `${label} contains missing or unknown fields.`, {
      cause: { missing, unknown },
    });
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function digestValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex');
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new GrantValidationError('INVALID_DRAFT', `${label} must be a canonical UTC timestamp.`);
  }
  const canonical = new Date(value).toISOString();
  if (canonical !== value) {
    throw new GrantValidationError('INVALID_DRAFT', `${label} must be a canonical UTC timestamp.`);
  }
  return value;
}

function canonicalText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new GrantValidationError('INVALID_DRAFT', `${label} is empty, oversized, or contains non-canonical text.`);
  }
  return value;
}

function canonicalNameList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLLECTION_SIZE) {
    throw new GrantValidationError('INVALID_DRAFT', `${label} must contain between one and ${MAX_COLLECTION_SIZE} entries.`);
  }
  const result = value.map((entry, index) => {
    const name = canonicalText(entry, `${label}[${index}]`, 64);
    if (!OPERATION_PATTERN.test(name)) {
      throw new GrantValidationError('INVALID_DRAFT', `${label}[${index}] is not a canonical operation or capability name.`);
    }
    return name;
  }).sort();
  if (new Set(result).size !== result.length) {
    throw new GrantValidationError('INVALID_DRAFT', `${label} contains duplicates.`);
  }
  return result;
}

export function canonicalizeGrantPathPattern(value: unknown): string {
  const path = canonicalText(value, 'Path scope entry', 512);
  if (
    !path.startsWith('/')
    || path === '/'
    || path.includes('\\')
    || path.includes(':')
    || /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new GrantValidationError('INVALID_DRAFT', 'Path scope must be a canonical repository-rooted pattern using forward slashes.');
  }
  const components = path.slice(1).split('/');
  if (components.some((component) => component.length === 0 || component === '.' || component === '..')) {
    throw new GrantValidationError('INVALID_DRAFT', 'Path scope cannot contain empty, current, or parent path components.');
  }
  const firstComponent = components[0]!;
  if (PATH_META_PATTERN.test(firstComponent)) {
    throw new GrantValidationError('INVALID_DRAFT', 'Path scope must identify a literal top-level directory and cannot span the repository root.');
  }
  if (firstComponent.toLowerCase() === '.changebudget') {
    throw new GrantValidationError('INVALID_DRAFT', 'Protected .changebudget paths cannot be granted.');
  }
  if (!PATH_META_PATTERN.test(path)) {
    const literal = canonicalizeLiteralPath(path.slice(1));
    if (literal === null || isChangeBudgetPath(literal) || `/${literal}` !== path) {
      throw new GrantValidationError('INVALID_DRAFT', 'Literal path scope is not a safe canonical repository-relative path.');
    }
  }
  try {
    compilePathPatterns([path]);
  } catch (error) {
    throw new GrantValidationError('INVALID_DRAFT', 'Path scope contains an invalid path pattern.', { cause: error });
  }
  return path;
}

function normalizeCeilings(value: unknown): GrantCeilings {
  if (!isRecord(value)) throw new GrantValidationError('INVALID_DRAFT', 'Ceilings must be an object.');
  exactKeys(value, [], ['max_files', 'max_changed_lines'], 'Ceilings');
  const result: { max_files?: number; max_changed_lines?: number } = {};
  for (const field of ['max_files', 'max_changed_lines'] as const) {
    if (!Object.hasOwn(value, field)) continue;
    const ceiling = value[field];
    if (!Number.isSafeInteger(ceiling) || (ceiling as number) < 0) {
      throw new GrantValidationError('INVALID_DRAFT', `${field} ceiling must be a non-negative safe integer.`);
    }
    result[field] = ceiling as number;
  }
  return result;
}

function normalizeRequestedCeilings(value: unknown): Required<GrantCeilings> {
  if (!isRecord(value)) throw new GrantValidationError('INVALID_DRAFT', 'Requested ceilings must be an object.');
  exactKeys(value, ['max_files', 'max_changed_lines'], [], 'Requested ceilings');
  const normalized = normalizeCeilings(value);
  return {
    max_files: normalized.max_files!,
    max_changed_lines: normalized.max_changed_lines!,
  };
}

function normalizeRequestedPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLLECTION_SIZE) {
    throw new GrantValidationError('INVALID_DRAFT', `requested_paths must contain between one and ${MAX_COLLECTION_SIZE} entries.`);
  }
  const paths = value.map((entry, index) => {
    const path = canonicalText(entry, `requested_paths[${index}]`, 512);
    const components = path.split('/');
    if (
      path.startsWith('/')
      || path.includes('\\')
      || path.includes(':')
      || PATH_META_PATTERN.test(path)
      || components.some((component) => component.length === 0 || component === '.' || component === '..')
      || components.some((component) => component.endsWith('.') || component.endsWith(' '))
      || components.some((component) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(component))
      || isChangeBudgetPath(path)
    ) {
      throw new GrantValidationError('INVALID_DRAFT', `requested_paths[${index}] is not a canonical safe repository-relative literal path.`);
    }
    const canonical = canonicalizeLiteralPath(path);
    if (canonical === null || canonical !== path) {
      throw new GrantValidationError('INVALID_DRAFT', `requested_paths[${index}] is not a canonical safe repository-relative literal path.`);
    }
    return path;
  }).sort();
  if (new Set(paths).size !== paths.length) {
    throw new GrantValidationError('INVALID_DRAFT', 'requested_paths contains duplicates.');
  }
  return paths;
}

/** Strict internal boundary for the untrusted operation description used by G4. */
export function normalizeAuthorityUseRequest(value: unknown): AuthorityUseRequest {
  if (!isRecord(value)) throw new GrantValidationError('INVALID_DRAFT', 'Authority-use request must be a JSON object.');
  exactKeys(value, [
    'grant_reference_id', 'requested_operation', 'requested_capabilities',
    'requested_paths', 'requested_ceilings', 'requested_permissions',
  ], [], 'Authority-use request');
  requireUuid(value.grant_reference_id, 'grant_reference_id');
  const operation = canonicalText(value.requested_operation, 'requested_operation', 64);
  if (!OPERATION_PATTERN.test(operation)) {
    throw new GrantValidationError('INVALID_DRAFT', 'requested_operation is not a canonical operation name.');
  }
  return {
    grant_reference_id: value.grant_reference_id,
    requested_operation: operation,
    requested_capabilities: canonicalNameList(value.requested_capabilities, 'requested_capabilities'),
    requested_paths: normalizeRequestedPaths(value.requested_paths),
    requested_ceilings: normalizeRequestedCeilings(value.requested_ceilings),
    requested_permissions: normalizePermissions(value.requested_permissions),
  };
}

const PERMISSION_FIELDS = [
  'allow_new_files',
  'allow_dependencies',
  'allow_migrations',
  'allow_configuration',
  'allow_public_api',
] as const;

function normalizePermissions(value: unknown): GrantPermissions {
  if (!isRecord(value)) throw new GrantValidationError('INVALID_DRAFT', 'Permissions must be an object.');
  exactKeys(value, PERMISSION_FIELDS, [], 'Permissions');
  for (const field of PERMISSION_FIELDS) {
    if (typeof value[field] !== 'boolean') {
      throw new GrantValidationError('INVALID_DRAFT', `${field} must be an explicit boolean.`);
    }
  }
  return {
    allow_new_files: value.allow_new_files as boolean,
    allow_dependencies: value.allow_dependencies as boolean,
    allow_migrations: value.allow_migrations as boolean,
    allow_configuration: value.allow_configuration as boolean,
    allow_public_api: value.allow_public_api as boolean,
  };
}

export function normalizeGrantDraft(value: unknown): GrantDraft {
  if (!isRecord(value)) throw new GrantValidationError('INVALID_DRAFT', 'Grant request must be a JSON object.');
  exactKeys(value, [
    'operations', 'capabilities', 'path_scope', 'ceilings', 'permissions', 'mode', 'valid_from', 'expires_at',
  ], ['subject_label'], 'Grant request');
  const subjectLabel = Object.hasOwn(value, 'subject_label')
    ? canonicalText(value.subject_label, 'Subject label', 256)
    : undefined;
  const operations = canonicalNameList(value.operations, 'operations');
  const capabilities = canonicalNameList(value.capabilities, 'capabilities');
  if (!Array.isArray(value.path_scope) || value.path_scope.length === 0 || value.path_scope.length > MAX_COLLECTION_SIZE) {
    throw new GrantValidationError('INVALID_DRAFT', `path_scope must contain between one and ${MAX_COLLECTION_SIZE} entries.`);
  }
  const pathScope = value.path_scope.map(canonicalizeGrantPathPattern).sort();
  if (new Set(pathScope).size !== pathScope.length) {
    throw new GrantValidationError('INVALID_DRAFT', 'path_scope contains duplicate entries.');
  }
  if (value.mode !== 'REUSABLE' && value.mode !== 'ONE_SHOT') {
    throw new GrantValidationError('INVALID_DRAFT', 'mode must be REUSABLE or ONE_SHOT.');
  }
  const validFrom = canonicalTimestamp(value.valid_from, 'valid_from');
  const expiresAt = canonicalTimestamp(value.expires_at, 'expires_at');
  if (Date.parse(expiresAt) <= Date.parse(validFrom)) {
    throw new GrantValidationError('INVALID_DRAFT', 'expires_at must be later than valid_from.');
  }
  return {
    ...(subjectLabel === undefined ? {} : { subject_label: subjectLabel }),
    operations,
    capabilities,
    path_scope: pathScope,
    ceilings: normalizeCeilings(value.ceilings),
    permissions: normalizePermissions(value.permissions),
    mode: value.mode,
    valid_from: validFrom,
    expires_at: expiresAt,
  };
}

function assertNoDuplicateJsonKeys(source: string): void {
  let index = 0;
  const skipWhitespace = (): void => {
    while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  };
  const parseStringToken = (): string => {
    const start = index;
    if (source[index] !== '"') throw new SyntaxError('Expected JSON string.');
    index += 1;
    while (index < source.length) {
      const character = source[index]!;
      index += 1;
      if (character === '"') return JSON.parse(source.slice(start, index)) as string;
      if (character === '\\') index += 1;
      else if (character < ' ') throw new SyntaxError('Invalid control character in JSON string.');
    }
    throw new SyntaxError('Unterminated JSON string.');
  };
  const parseValue = (): void => {
    skipWhitespace();
    const character = source[index];
    if (character === '"') {
      parseStringToken();
      return;
    }
    if (character === '{') {
      index += 1;
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      const keys = new Set<string>();
      while (index < source.length) {
        skipWhitespace();
        const key = parseStringToken();
        if (keys.has(key)) throw new GrantValidationError('DUPLICATE_FIELD', `Duplicate JSON field ${key}.`);
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ':') throw new SyntaxError('Expected colon after JSON object key.');
        index += 1;
        parseValue();
        skipWhitespace();
        if (source[index] === '}') {
          index += 1;
          return;
        }
        if (source[index] !== ',') throw new SyntaxError('Expected comma in JSON object.');
        index += 1;
      }
      throw new SyntaxError('Unterminated JSON object.');
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      while (index < source.length) {
        parseValue();
        skipWhitespace();
        if (source[index] === ']') {
          index += 1;
          return;
        }
        if (source[index] !== ',') throw new SyntaxError('Expected comma in JSON array.');
        index += 1;
      }
      throw new SyntaxError('Unterminated JSON array.');
    }
    const start = index;
    while (index < source.length && !/[\s,\]}]/u.test(source[index]!)) index += 1;
    if (index === start) throw new SyntaxError('Expected JSON value.');
  };

  parseValue();
  skipWhitespace();
  if (index !== source.length) throw new SyntaxError('Unexpected trailing JSON content.');
}

export function parseGrantDraftJson(source: string): GrantDraft {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_GRANT_JSON_BYTES) {
    throw new GrantValidationError('INVALID_DRAFT', 'Grant request JSON is missing or exceeds its size limit.');
  }
  try {
    assertNoDuplicateJsonKeys(source);
    return normalizeGrantDraft(JSON.parse(source) as unknown);
  } catch (error) {
    if (error instanceof GrantValidationError) throw error;
    throw new GrantValidationError('INVALID_DRAFT', 'Grant request is not valid strict JSON.', { cause: error });
  }
}

export function mapContractPermissionsToGrant(value: {
  readonly allow_new_files: boolean;
  readonly allow_new_dependencies: boolean;
  readonly allow_migrations: boolean;
  readonly allow_config_changes: boolean;
  readonly allow_public_api_changes: boolean;
}): GrantPermissions {
  return {
    allow_new_files: value.allow_new_files,
    allow_dependencies: value.allow_new_dependencies,
    allow_migrations: value.allow_migrations,
    allow_configuration: value.allow_config_changes,
    allow_public_api: value.allow_public_api_changes,
  };
}

function canonicalGrantContent(grant: Omit<CanonicalGrantRecord, 'grant_digest'>): string {
  return JSON.stringify(stableValue(grant));
}

export function createCanonicalGrantRecord(
  draft: GrantDraft,
  binding: GrantBindingContext,
  input: { readonly created_at: string; readonly audit_correlation_id: string },
): CanonicalGrantRecord {
  const normalizedDraft = normalizeGrantDraft(draft);
  const body: Omit<CanonicalGrantRecord, 'grant_digest'> = {
    grant_schema_version: GRANT_SCHEMA_VERSION,
    grant_id: randomUUID(),
    repository_reference_id: binding.repository_reference_id,
    repository_binding_epoch: binding.repository_binding_epoch,
    authority_id: binding.authority_id,
    work_id: binding.work_id,
    work_activation_id: binding.work_activation_id,
    work_activation_epoch: binding.work_activation_epoch,
    subject_id: binding.subject_id,
    subject_label: normalizedDraft.subject_label ?? binding.subject_label,
    contract_id: binding.contract_id,
    task_id: binding.task_id,
    contract_revision_digest: binding.contract_revision_digest,
    scope_digest: binding.scope_digest,
    authority_revision: binding.authority_revision,
    operations: normalizedDraft.operations,
    capabilities: normalizedDraft.capabilities,
    path_scope: normalizedDraft.path_scope,
    ceilings: normalizedDraft.ceilings,
    permissions: normalizedDraft.permissions,
    mode: normalizedDraft.mode,
    valid_from: normalizedDraft.valid_from,
    expires_at: normalizedDraft.expires_at,
    issuer: {
      kind: 'CHANGE_BUDGET_DIRECT_ADMIN',
      execution_boundary: 'OUTSIDE_GOVERNED_RUNTIME',
      audit_correlation_id: input.audit_correlation_id,
    },
    created_at: canonicalTimestamp(input.created_at, 'created_at'),
  };
  requireUuid(binding.repository_reference_id, 'repository_reference_id');
  requirePositiveSafeInteger(binding.repository_binding_epoch, 'repository_binding_epoch');
  requireUuid(binding.authority_id, 'authority_id');
  requireUuid(binding.work_id, 'work_id');
  requireUuid(binding.work_activation_id, 'work_activation_id');
  requirePositiveSafeInteger(binding.work_activation_epoch, 'work_activation_epoch');
  requireUuid(binding.subject_id, 'subject_id');
  if (binding.subject_label !== null) canonicalText(binding.subject_label, 'subject_label', 256);
  if (binding.contract_id !== null && !CONTRACT_ID_PATTERN.test(binding.contract_id)) {
    throw new GrantValidationError('INVALID_GRANT', 'contract_id is not a canonical ChangeBudget contract identifier.');
  }
  if (binding.task_id !== null) canonicalText(binding.task_id, 'task_id', 256);
  requireDigest(binding.contract_revision_digest, 'contract_revision_digest');
  requireDigest(binding.scope_digest, 'scope_digest');
  requirePositiveSafeInteger(binding.authority_revision, 'authority_revision');
  requireUuid(input.audit_correlation_id, 'audit_correlation_id');
  const grant = { ...body, grant_digest: digestValue(body) };
  validateCanonicalGrantRecord(grant);
  return grant;
}

function requireUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new GrantValidationError('INVALID_GRANT', `${label} is not a canonical opaque ID.`);
  }
}

function requirePositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new GrantValidationError('INVALID_GRANT', `${label} must be a positive safe integer.`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new GrantValidationError('INVALID_GRANT', `${label} is not a canonical SHA-256 digest.`);
  }
}

export function validateCanonicalGrantRecord(value: unknown): CanonicalGrantRecord {
  if (!isRecord(value)) throw new GrantValidationError('INVALID_GRANT', 'Canonical grant is not an object.');
  exactKeys(value, [
    'grant_schema_version', 'grant_id', 'repository_reference_id', 'repository_binding_epoch',
    'authority_id', 'work_id', 'work_activation_id', 'work_activation_epoch', 'subject_id', 'subject_label',
    'contract_id', 'task_id', 'contract_revision_digest', 'scope_digest', 'authority_revision',
    'operations', 'capabilities', 'path_scope', 'ceilings', 'permissions', 'mode', 'valid_from', 'expires_at',
    'issuer', 'created_at', 'grant_digest',
  ], [], 'Canonical grant');
  if (value.grant_schema_version !== GRANT_SCHEMA_VERSION) {
    throw new GrantValidationError('INVALID_GRANT', 'Canonical grant schema version is unsupported.');
  }
  requireUuid(value.grant_id, 'grant_id');
  requireUuid(value.repository_reference_id, 'repository_reference_id');
  requirePositiveSafeInteger(value.repository_binding_epoch, 'repository_binding_epoch');
  requireUuid(value.authority_id, 'authority_id');
  requireUuid(value.work_id, 'work_id');
  requireUuid(value.work_activation_id, 'work_activation_id');
  requirePositiveSafeInteger(value.work_activation_epoch, 'work_activation_epoch');
  requireUuid(value.subject_id, 'subject_id');
  if (value.subject_label !== null) canonicalText(value.subject_label, 'subject_label', 256);
  if (value.contract_id !== null && (typeof value.contract_id !== 'string' || !CONTRACT_ID_PATTERN.test(value.contract_id))) {
    throw new GrantValidationError('INVALID_GRANT', 'contract_id is not a canonical ChangeBudget contract identifier.');
  }
  if (value.task_id !== null) canonicalText(value.task_id, 'task_id', 256);
  requireDigest(value.contract_revision_digest, 'contract_revision_digest');
  requireDigest(value.scope_digest, 'scope_digest');
  requirePositiveSafeInteger(value.authority_revision, 'authority_revision');
  const normalized = normalizeGrantDraft({
    ...(value.subject_label === null ? {} : { subject_label: value.subject_label }),
    operations: value.operations,
    capabilities: value.capabilities,
    path_scope: value.path_scope,
    ceilings: value.ceilings,
    permissions: value.permissions,
    mode: value.mode,
    valid_from: value.valid_from,
    expires_at: value.expires_at,
  });
  if (value.subject_label !== null && normalized.subject_label !== value.subject_label) {
    throw new GrantValidationError('INVALID_GRANT', 'Canonical subject label is not normalized.');
  }
  if (!isRecord(value.issuer)) throw new GrantValidationError('INVALID_GRANT', 'Canonical grant issuer is missing.');
  exactKeys(value.issuer, ['kind', 'execution_boundary', 'audit_correlation_id'], [], 'Grant issuer');
  if (value.issuer.kind !== 'CHANGE_BUDGET_DIRECT_ADMIN' || value.issuer.execution_boundary !== 'OUTSIDE_GOVERNED_RUNTIME') {
    throw new GrantValidationError('INVALID_GRANT', 'Canonical grant provenance is unsupported.');
  }
  requireUuid(value.issuer.audit_correlation_id, 'audit_correlation_id');
  canonicalTimestamp(value.created_at, 'created_at');
  requireDigest(value.grant_digest, 'grant_digest');

  const withoutDigest = { ...value } as Record<string, unknown>;
  delete withoutDigest.grant_digest;
  if (digestValue(withoutDigest) !== value.grant_digest) {
    throw new GrantValidationError('DIGEST_MISMATCH', 'Canonical grant digest does not match its immutable content.');
  }
  return value as unknown as CanonicalGrantRecord;
}

export function verifyGrantDigest(value: unknown): boolean {
  try {
    validateCanonicalGrantRecord(value);
    return true;
  } catch {
    return false;
  }
}

export function grantMatchesPathScope(grant: CanonicalGrantRecord, repositoryRelativePath: string): boolean {
  if (
    typeof repositoryRelativePath !== 'string'
    || repositoryRelativePath.startsWith('/')
    || repositoryRelativePath.includes('\\')
    || repositoryRelativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
    || repositoryRelativePath.split('/')[0]?.toLowerCase() === '.changebudget'
  ) {
    return false;
  }
  try {
    return matchPathPattern(repositoryRelativePath, compilePathPatterns([...grant.path_scope]));
  } catch {
    return false;
  }
}
