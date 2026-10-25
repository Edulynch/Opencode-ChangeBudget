import { stdout } from 'node:process';

import { createAuthorityService } from '../../core/authority/authority-service.js';
import { parseGrantDraftJson } from '../../core/authority/grants.js';
import { InputValidationError } from '../../models/errors.js';

const TRUST_BOUNDARY = 'Direct administration outside the supported governed runtime is a trust premise, not proof of human identity.';

function nextValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new InputValidationError(`Missing value for ${option}`, option);
  }
  return value;
}

function parseOptions(args: readonly string[], allowed: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) {
      throw new InputValidationError(`Unexpected positional argument: ${token}`, 'authority');
    }
    const separator = token.indexOf('=');
    const key = token.slice(2, separator === -1 ? undefined : separator);
    if (!allowed.includes(key)) {
      throw new InputValidationError(`Unsupported authority option --${key}`, `--${key}`);
    }
    if (options.has(key)) throw new InputValidationError(`Duplicate authority option --${key}`, `--${key}`);
    const value = separator === -1 ? nextValue(args, index, `--${key}`) : token.slice(separator + 1);
    if (separator === -1) index += 1;
    if (value.length === 0) throw new InputValidationError(`Empty value for --${key}`, `--${key}`);
    options.set(key, value);
  }
  return options;
}

function requireOnly(options: Map<string, string>, fields: readonly string[], command: string): void {
  const actual = [...options.keys()].sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new InputValidationError(`${command} requires exactly: ${expected.map((field) => `--${field}`).join(', ')}`, 'authority');
  }
}

function writeJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runAuthority(repositoryRootHint: string, args: readonly string[]): Promise<void> {
  if (args[0] === 'rebind') {
    throw new InputValidationError('Authority rebind is reserved and not implemented; no repository or grant is changed.', 'authority');
  }
  if (args[0] !== 'grant' || args.length < 2) {
    throw new InputValidationError('Usage: changebudget authority grant <create|list|inspect|revoke>', 'authority');
  }

  const operation = args[1];
  const commandArgs = args.slice(2);
  const service = createAuthorityService();
  if (operation === 'create') {
    const options = parseOptions(commandArgs, ['request-json']);
    requireOnly(options, ['request-json'], 'authority grant create');
    const draft = parseGrantDraftJson(options.get('request-json')!);
    const grant = await service.createGrant(repositoryRootHint, draft);
    writeJson({ status: 'SUCCESS', grant, trust_boundary: TRUST_BOUNDARY });
    return;
  }
  if (operation === 'list') {
    if (commandArgs.length !== 0) throw new InputValidationError('authority grant list accepts no options.', 'authority');
    writeJson({ grants: await service.listGrants(repositoryRootHint) });
    return;
  }
  if (operation === 'inspect') {
    const options = parseOptions(commandArgs, ['grant-id']);
    requireOnly(options, ['grant-id'], 'authority grant inspect');
    writeJson({ grant: await service.inspectGrant(repositoryRootHint, options.get('grant-id')!) });
    return;
  }
  if (operation === 'revoke') {
    const options = parseOptions(commandArgs, ['grant-id', 'expected-digest']);
    requireOnly(options, ['grant-id', 'expected-digest'], 'authority grant revoke');
    const grant = await service.revokeGrant(
      repositoryRootHint,
      options.get('grant-id')!,
      options.get('expected-digest')!,
    );
    writeJson({ status: 'SUCCESS', grant, trust_boundary: TRUST_BOUNDARY });
    return;
  }
  throw new InputValidationError(`Unsupported authority grant operation: ${String(operation)}`, 'authority');
}
