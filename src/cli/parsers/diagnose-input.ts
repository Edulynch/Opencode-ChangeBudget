import { InputValidationError } from '../../models/errors.js';
import { DiagnoseInput } from '../../models/diagnose.js';
import { isStackProfile, STACK_PROFILES } from '../../models/change-contract.js';

function normalizeFlagName(raw: string): string {
  return raw.toLowerCase().replace(/_/g, '-');
}

function parseBoolean(value: string): boolean {
  const lowered = value.toLowerCase();
  if (lowered === 'true') {
    return true;
  }

  if (lowered === 'false') {
    return false;
  }

  throw new InputValidationError(`Expected boolean value "${value}"`, 'json');
}

function nextOptionValue(args: string[], index: number): { value: string; nextIndex: number } {
  if (index + 1 >= args.length) {
    throw new InputValidationError(`Missing value for option ${args[index]}`, args[index]);
  }

  const value = args[index + 1];
  if (value.startsWith('--')) {
    throw new InputValidationError(`Missing value for option ${args[index]}`, args[index]);
  }

  return { value, nextIndex: index + 1 };
}

export function parseDiagnoseArgs(args: string[]): DiagnoseInput {
  const parsed: DiagnoseInput = {
    task_id: null,
    task_description: null,
    allow_paths: [],
    deny_paths: [],
    stack_profile: null,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
    }

    const pair = token.slice(2).split('=', 2);
    const key = normalizeFlagName(pair[0]);
    const inlineValue = pair.length === 2 ? pair[1] : null;

    if (inlineValue !== null && inlineValue.length === 0) {
      throw new InputValidationError(`Empty value for option --${key}`, key);
    }

    switch (key) {
      case 'task':
      case 'task-description': {
        const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
        if (inlineValue === null) {
          index += 1;
        }
        parsed.task_description = value.trim();
        break;
      }

      case 'allow-path':
      case 'allow-paths': {
        const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
        if (inlineValue === null) {
          index += 1;
        }
        parsed.allow_paths.push(value.trim());
        break;
      }

      case 'deny-path':
      case 'deny-paths': {
        const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
        if (inlineValue === null) {
          index += 1;
        }
        parsed.deny_paths.push(value.trim());
        break;
      }

      case 'stack-profile': {
        const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
        if (inlineValue === null) {
          index += 1;
        }

        const candidate = value.toLowerCase();
        if (!isStackProfile(candidate)) {
          throw new InputValidationError(
            `Invalid stack profile. Allowed values: ${STACK_PROFILES.join(', ')}`,
            'stack-profile',
            { value: candidate },
          );
        }

        parsed.stack_profile = candidate;
        break;
      }

      case 'json':
        if (inlineValue === null) {
          parsed.json = true;
        } else {
          parsed.json = parseBoolean(inlineValue);
        }
        break;

      case 'preset':
      case 'tiny':
      case 'normal':
      case 'free':
      case 'custom':
        throw new InputValidationError(
          `Option --${key} is not supported by diagnose; the recommendation is advisory only.`,
          `--${key}`,
        );

      default:
        throw new InputValidationError(`Unknown option --${key}`, `--${key}`);
    }
  }

  return parsed;
}
