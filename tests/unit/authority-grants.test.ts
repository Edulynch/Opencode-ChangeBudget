import * as assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const grantsModuleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/core/authority/grants.js')).href;

async function grants(): Promise<any> {
  return import(grantsModuleUrl);
}

function validDraft(): Record<string, unknown> {
  return {
    subject_label: 'descriptive operator selection',
    operations: ['file.write'],
    capabilities: ['source.edit'],
    path_scope: ['/src/**'],
    ceilings: { max_files: 60, max_changed_lines: 240 },
    permissions: {
      allow_new_files: false,
      allow_dependencies: false,
      allow_migrations: false,
      allow_configuration: false,
      allow_public_api: false,
    },
    mode: 'REUSABLE',
    valid_from: '2026-10-15T00:00:00.000Z',
    expires_at: '2026-10-16T00:00:00.000Z',
  };
}

test('G3: grant draft validation is exact, canonical, and does not accept identity fields', async () => {
  const { normalizeGrantDraft } = await grants();
  const draft = normalizeGrantDraft(validDraft());
  assert.deepEqual(draft.operations, ['file.write']);
  assert.deepEqual(draft.path_scope, ['/src/**']);
  assert.equal(draft.permissions.allow_new_files, false);
  assert.equal(draft.permissions.allow_dependencies, false);

  for (const field of ['grant_id', 'work_id', 'subject_id', 'authority_id', 'repository_reference_id', 'grant_digest']) {
    assert.throws(() => normalizeGrantDraft({ ...validDraft(), [field]: 'caller-minted' }), /unknown|unsupported|field/i, field);
  }
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), unexpected: true }), /unknown|unsupported|field/i);
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), subject_label: '   ' }), /subject|label/i);
});

test('G3: duplicate JSON keys, invalid timestamps, and invalid mode fail closed', async () => {
  const { parseGrantDraftJson, normalizeGrantDraft } = await grants();
  const duplicated = JSON.stringify(validDraft()).replace('"mode":"REUSABLE"', '"mode":"REUSABLE","mode":"ONE_SHOT"');
  assert.throws(() => parseGrantDraftJson(duplicated), /duplicate|invalid|JSON/i);
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), valid_from: '2026-10-15' }), /timestamp|validity|time/i);
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), valid_from: '2026-10-16T00:00:00.000Z' }), /validity|expiry|expires/i);
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), mode: 'ADMIN' }), /mode/i);
});

test('G3: ceilings are non-negative safe integers and permissions remain independent', async () => {
  const { normalizeGrantDraft } = await grants();
  for (const max_files of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '60']) {
    assert.throws(() => normalizeGrantDraft({ ...validDraft(), ceilings: { max_files } }), /ceiling|safe integer|non-negative/i);
  }

  const draft = normalizeGrantDraft({
    ...validDraft(),
    permissions: {
      allow_new_files: true,
      allow_dependencies: false,
      allow_migrations: true,
      allow_configuration: false,
      allow_public_api: true,
    },
  });
  assert.deepEqual(draft.permissions, {
    allow_new_files: true,
    allow_dependencies: false,
    allow_migrations: true,
    allow_configuration: false,
    allow_public_api: true,
  });
});

test('G3: path scope rejects traversal, protected metadata, and unbounded-root patterns', async () => {
  const { normalizeGrantDraft } = await grants();
  for (const path of ['/src/../secret', ['/src/../../*'], ['/.changebudget/**'], ['/**'], ['/src/../../.changebudget/**']]) {
    assert.throws(() => normalizeGrantDraft({ ...validDraft(), path_scope: Array.isArray(path) ? path : [path] }), /path|scope|protected/i);
  }
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), path_scope: ['/src/**', '/src/**'] }), /duplicate/i);
  assert.throws(() => normalizeGrantDraft({ ...validDraft(), capabilities: ['source.edit', 'source.edit'] }), /duplicate/i);
});

test('G3: contract flags are explicitly mapped to grant permission names', async () => {
  const { mapContractPermissionsToGrant } = await grants();
  assert.deepEqual(mapContractPermissionsToGrant({
    allow_new_files: true,
    allow_new_dependencies: false,
    allow_migrations: true,
    allow_config_changes: false,
    allow_public_api_changes: true,
  }), {
    allow_new_files: true,
    allow_dependencies: false,
    allow_migrations: true,
    allow_configuration: false,
    allow_public_api: true,
  });
});

test('G3: canonical grant digest covers immutable content and rejects tampering', async () => {
  const { createCanonicalGrantRecord, validateCanonicalGrantRecord, verifyGrantDigest } = await grants();
  const draft = (await grants()).normalizeGrantDraft({
    ...validDraft(),
    valid_from: '2020-01-01T00:00:00.000Z',
    expires_at: '2021-01-01T00:00:00.000Z',
  });
  const grant = createCanonicalGrantRecord(draft, {
    repository_reference_id: '11111111-1111-4111-8111-111111111111',
    repository_binding_epoch: 1,
    authority_id: '22222222-2222-4222-8222-222222222222',
    work_id: '33333333-3333-4333-8333-333333333333',
    work_activation_id: '44444444-4444-4444-8444-444444444444',
    work_activation_epoch: 1,
    subject_id: '55555555-5555-4555-8555-555555555555',
    subject_label: 'descriptive operator selection',
    contract_id: null,
    task_id: null,
    contract_revision_digest: 'a'.repeat(64),
    scope_digest: 'b'.repeat(64),
    authority_revision: 1,
  }, {
    created_at: '2026-10-15T00:00:00.000Z',
    audit_correlation_id: '66666666-6666-4666-8666-666666666666',
  });
  assert.equal(verifyGrantDigest(grant), true);
  assert.equal(validateCanonicalGrantRecord(grant).grant_id, grant.grant_id);
  assert.equal(validateCanonicalGrantRecord(grant).expires_at, '2021-01-01T00:00:00.000Z',
    'canonical persisted-grant validation is time-independent; service operations decide current expiry');
  assert.throws(() => validateCanonicalGrantRecord({ ...grant, path_scope: ['/src/**', '/docs/**'] }), /digest|canonical|grant/i);
  assert.throws(() => validateCanonicalGrantRecord({ ...grant, lifecycle: 'ACTIVE' }), /unknown|field/i);
});

test('T018: authority-use descriptors are exact, canonical, independent, and preserve narrower ceilings', async () => {
  const { normalizeAuthorityUseRequest } = await grants();
  const baseRequest = {
    grant_reference_id: '11111111-1111-4111-8111-111111111111',
    requested_operation: 'file.write',
    requested_capabilities: ['source.edit'],
    requested_paths: ['src/feature.ts'],
    requested_permissions: {
      allow_new_files: true,
      allow_dependencies: false,
      allow_migrations: true,
      allow_configuration: false,
      allow_public_api: true,
    },
  };
  const request = normalizeAuthorityUseRequest({
    ...baseRequest,
    requested_ceilings: { max_files: 18, max_changed_lines: 240 },
  });
  assert.deepEqual(request.requested_ceilings, { max_files: 18, max_changed_lines: 240 },
    'normalization preserves requested narrower values instead of copying grant maxima');
  assert.deepEqual(request.requested_permissions, {
    allow_new_files: true,
    allow_dependencies: false,
    allow_migrations: true,
    allow_configuration: false,
    allow_public_api: true,
  }, 'sensitive permission facts remain independent');

  for (const missingField of ['max_files', 'max_changed_lines'] as const) {
    const incompleteCeilings: Record<string, unknown> = { max_files: 18, max_changed_lines: 240 };
    delete incompleteCeilings[missingField];
    assert.throws(() => normalizeAuthorityUseRequest({
      ...baseRequest,
      requested_ceilings: incompleteCeilings,
    }), /missing|required|ceiling/i, `${missingField} cannot be silently treated as unlimited`);
  }

  const invalidPaths = [
    '../outside.ts', 'src/../outside.ts', 'src//file.ts', 'src/./file.ts',
    'C:/outside.ts', '\\\\server\\share\\file.ts', 'src\\file.ts',
    '/absolute/file.ts', '.changebudget/authority-reference.json', 'src/file.ts ',
  ];
  for (const requestedPath of invalidPaths) {
    assert.throws(() => normalizeAuthorityUseRequest({
      grant_reference_id: '11111111-1111-4111-8111-111111111111',
      requested_operation: 'file.write',
      requested_capabilities: ['source.edit'],
      requested_paths: [requestedPath],
      requested_ceilings: { max_files: 1 },
      requested_permissions: {
        allow_new_files: false,
        allow_dependencies: false,
        allow_migrations: false,
        allow_configuration: false,
        allow_public_api: false,
      },
    }), /path|canonical|protected|invalid/i, requestedPath);
  }

  assert.throws(() => normalizeAuthorityUseRequest({
    grant_reference_id: '11111111-1111-4111-8111-111111111111',
    requested_operation: 'file.write',
    requested_capabilities: ['source.edit'],
    requested_paths: ['src/file.ts'],
    requested_ceilings: { max_files: Number.MAX_SAFE_INTEGER + 1, max_changed_lines: 200 },
    requested_permissions: {
      allow_new_files: false,
      allow_dependencies: false,
      allow_migrations: false,
      allow_configuration: false,
      allow_public_api: false,
    },
  }), /ceiling|safe integer|invalid/i);
  assert.throws(() => normalizeAuthorityUseRequest({
    grant_reference_id: '11111111-1111-4111-8111-111111111111',
    requested_operation: 'file.write',
    requested_capabilities: ['source.edit'],
    requested_paths: ['src/file.ts'],
    requested_ceilings: { max_files: 1, max_changed_lines: 1 },
    requested_permissions: { allow_new_files: true },
  }), /permission|field|unknown|missing|invalid/i);
  for (const field of [
    'grant_id', 'grant_digest', 'repository_reference_id', 'repository_binding_epoch',
    'authority_id', 'work_id', 'work_activation_id', 'work_activation_epoch',
    'subject_id', 'contract_id', 'task_id', 'authority_revision', 'grant', 'grant_body',
    'trusted', 'is_trusted',
  ]) {
    assert.throws(() => normalizeAuthorityUseRequest({
      ...baseRequest,
      requested_ceilings: { max_files: 1, max_changed_lines: 1 },
      [field]: 'caller-selected-authority-is-not-accepted',
    }), /unknown|field|identity/i, `${field} is not caller authority`);
  }
});
