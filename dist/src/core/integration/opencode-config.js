import { InputValidationError } from '../../models/errors.js';
import { INSTRUCTION_ENTRY } from './opencode-types.js';
/** Parse an `opencode.json` string into a typed object. */
export function parseOpenCodeConfig(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        throw new InputValidationError(`opencode.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, 'opencode.json', { cause: error instanceof Error ? error.message : String(error) });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new InputValidationError('opencode.json must contain a JSON object', 'opencode.json');
    }
    return parsed;
}
/** Return a new config with the given `entry` present in `instructions[]`. */
export function mergeInstructionEntry(config, entry) {
    if (config.instructions === undefined) {
        return { ...config, instructions: [entry] };
    }
    if (!Array.isArray(config.instructions)) {
        throw new InputValidationError('opencode.json "instructions" field must be an array', 'instructions');
    }
    if (config.instructions.includes(entry)) {
        return config;
    }
    return { ...config, instructions: [...config.instructions, entry] };
}
/** Serialize a config with deterministic 2-space indentation + trailing newline. */
export function serializeConfig(config) {
    return `${JSON.stringify(config, null, 2)}\n`;
}
/** Smallest valid `opencode.json` with the managed instructions entry already present. */
export function generateMinimalConfig() {
    return {
        $schema: 'https://opencode.ai/config.json',
        instructions: [INSTRUCTION_ENTRY],
    };
}
/** String form of the minimal config, ready to be written to disk. */
export function generateMinimalConfigString() {
    return serializeConfig(generateMinimalConfig());
}
//# sourceMappingURL=opencode-config.js.map