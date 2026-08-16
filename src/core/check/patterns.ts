import { InputValidationError } from '../../models/errors.js';

export interface CompiledPattern {
  pattern: string;
  regex: RegExp;
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\\/g, '/');
}

function escapeRegexCharacter(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toRegexSource(value: string): string {
  let index = 0;
  let source = '';

  while (index < value.length) {
    const current = value[index];

    if (current === '*') {
      if (value[index + 1] === '*') {
        index += 2;
        while (value[index] === '*') {
          index += 1;
        }

        source += '.*';
        continue;
      }

      source += '[^/]*';
      index += 1;
      continue;
    }

    if (current === '?') {
      source += '[^/]';
      index += 1;
      continue;
    }

    if (current === '[') {
      const closingIndex = value.indexOf(']', index + 1);
      if (closingIndex === -1) {
        throw new InputValidationError(`Invalid path pattern: missing closing "]"`, 'path-pattern', {
          pattern: value,
          position: index,
        });
      }

      const body = value.slice(index + 1, closingIndex);
      if (!body.length) {
        throw new InputValidationError('Invalid path pattern: empty character class', 'path-pattern', {
          pattern: value,
        });
      }

      const negated = body.startsWith('!') || body.startsWith('^');
      const classBody = body.slice(negated ? 1 : 0);

      if (classBody.includes('\n')) {
        throw new InputValidationError('Invalid path pattern: unsupported newline in character class', 'path-pattern', {
          pattern: value,
        });
      }

      const escapedClassBody = classBody
        .split('').map((char) => (char === '\\' ? '\\' : char)).join('')
        .replace(/\^|\-|\]|\\/g, (segment) => `\\${segment}`);

      source += `[${negated ? '^' : ''}${escapedClassBody}]`;
      index = closingIndex + 1;
      continue;
    }

    if (current === '\\') {
      if (index + 1 >= value.length) {
        throw new InputValidationError('Invalid path pattern: trailing escape', 'path-pattern', {
          pattern: value,
        });
      }

      source += escapeRegexCharacter(value[index + 1]);
      index += 2;
      continue;
    }

    source += escapeRegexCharacter(current);
    index += 1;
  }

  return source;
}

export function compilePathPatterns(patterns: string[]): CompiledPattern[] {
  return patterns.map((pattern) => compilePathPattern(pattern));
}

export function compilePathPattern(pattern: string): CompiledPattern {
  const normalized = normalizePattern(pattern);
  if (!normalized.length) {
    throw new InputValidationError('Path pattern cannot be empty', 'path-pattern', { pattern });
  }

  const anchored = normalized.startsWith('/');
  const body = anchored ? normalized.slice(1) : normalized;
  if (!body.length) {
    throw new InputValidationError('Path pattern cannot be only root', 'path-pattern', {
      pattern: normalized,
    });
  }

  const regexSource = toRegexSource(body);
  const source = anchored
    ? `^${regexSource}$`
    : `(?:^|/)${regexSource}(?:$|/)`;

  try {
    return {
      pattern: normalized,
      regex: new RegExp(source),
    };
  } catch {
    throw new InputValidationError('Invalid path pattern', 'path-pattern', {
      pattern: normalized,
    });
  }
}

export function matchPathPattern(path: string, patterns: CompiledPattern[]): boolean {
  const normalized = path.replace(/\\/g, '/');
  return patterns.some((entry) => entry.regex.test(normalized));
}
