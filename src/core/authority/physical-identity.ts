import { lstat, realpath } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';

export interface PhysicalObjectIdentity {
  readonly provider: 'node-lstat-bigint-v1';
  readonly platform: NodeJS.Platform;
  readonly volume_id: string;
  readonly file_id: string;
  /** Node's OS-provided creation-time generation discriminator; absent/zero is unsupported. */
  readonly generation: string;
}

export interface PhysicalStatSample {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
  readonly is_directory: boolean;
  readonly is_symbolic_link: boolean;
}

export class PhysicalIdentityError extends Error {
  readonly code: 'IDENTITY_UNAVAILABLE' | 'UNSAFE_PATH' | 'UNRELIABLE_VOLUME' | 'UNRELIABLE_FILE_ID' | 'UNRELIABLE_GENERATION';

  constructor(
    code: PhysicalIdentityError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PhysicalIdentityError';
    this.code = code;
  }
}

function requirePositive(value: bigint, code: PhysicalIdentityError['code'], label: string): string {
  if (value <= 0n) {
    throw new PhysicalIdentityError(code, `Physical identity has no reliable ${label}.`);
  }
  return value.toString(10);
}

export function physicalIdentityFromStats(
  sample: PhysicalStatSample,
  platform: NodeJS.Platform = process.platform,
): PhysicalObjectIdentity {
  if (!sample.is_directory || sample.is_symbolic_link) {
    throw new PhysicalIdentityError('UNSAFE_PATH', 'The physical anchor must be a non-link directory object.');
  }

  return {
    provider: 'node-lstat-bigint-v1',
    platform,
    volume_id: requirePositive(sample.dev, 'UNRELIABLE_VOLUME', 'volume identity'),
    file_id: requirePositive(sample.ino, 'UNRELIABLE_FILE_ID', 'file-object identity'),
    generation: requirePositive(sample.birthtimeNs, 'UNRELIABLE_GENERATION', 'object generation discriminator'),
  };
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const result = resolve(value);
    return process.platform === 'win32' ? result.toLowerCase() : result;
  };
  return normalize(left) === normalize(right);
}

async function rejectLinkOrReparseComponents(absolutePath: string): Promise<void> {
  const root = parse(absolutePath).root;
  if (!root) throw new PhysicalIdentityError('UNSAFE_PATH', 'The physical anchor path is not absolute.');

  const remainder = absolutePath.slice(root.length);
  const components = remainder.split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    const stats = await lstat(current, { bigint: true });
    const attributes = (stats as typeof stats & { readonly attributes?: number }).attributes;
    const windowsReparsePoint = process.platform === 'win32'
      && typeof attributes === 'number'
      && (attributes & 0x400) !== 0;
    if (stats.isSymbolicLink() || windowsReparsePoint) {
      throw new PhysicalIdentityError('UNSAFE_PATH', 'A symbolic-link or reparse component makes the physical anchor ambiguous.');
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      throw new PhysicalIdentityError('UNSAFE_PATH', 'A non-directory component makes the physical anchor path ambiguous.');
    }
  }
}

export async function resolvePhysicalObjectIdentity(path: string): Promise<PhysicalObjectIdentity> {
  try {
    const absolutePath = resolve(path);
    if (absolutePath === parse(absolutePath).root) {
      throw new PhysicalIdentityError('UNSAFE_PATH', 'A filesystem root cannot be a repository authority anchor.');
    }
    await rejectLinkOrReparseComponents(absolutePath);
    const canonicalPath = await realpath(absolutePath);
    if (!samePath(absolutePath, canonicalPath)) {
      throw new PhysicalIdentityError('UNSAFE_PATH', 'The physical anchor path resolves through an alias.');
    }

    const first = await lstat(absolutePath, { bigint: true });
    const firstIdentity = physicalIdentityFromStats({
      dev: first.dev,
      ino: first.ino,
      birthtimeNs: first.birthtimeNs,
      is_directory: first.isDirectory(),
      is_symbolic_link: first.isSymbolicLink(),
    });
    const canonicalAfterRead = await realpath(absolutePath);
    const second = await lstat(absolutePath, { bigint: true });
    const secondIdentity = physicalIdentityFromStats({
      dev: second.dev,
      ino: second.ino,
      birthtimeNs: second.birthtimeNs,
      is_directory: second.isDirectory(),
      is_symbolic_link: second.isSymbolicLink(),
    });
    if (!samePath(absolutePath, canonicalAfterRead) || !samePhysicalIdentity(firstIdentity, secondIdentity)) {
      throw new PhysicalIdentityError('IDENTITY_UNAVAILABLE', 'The physical anchor changed during identity resolution.');
    }
    return secondIdentity;
  } catch (error) {
    if (error instanceof PhysicalIdentityError) throw error;
    throw new PhysicalIdentityError(
      'IDENTITY_UNAVAILABLE',
      'The operating system did not provide a usable physical anchor identity.',
      { cause: error },
    );
  }
}

export function samePhysicalIdentity(
  left: PhysicalObjectIdentity,
  right: PhysicalObjectIdentity,
): boolean {
  return left.provider === right.provider
    && left.platform === right.platform
    && left.volume_id === right.volume_id
    && left.file_id === right.file_id
    && left.generation === right.generation;
}
