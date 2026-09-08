import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseOpenCodeConfig } from './opencode-config.js';
import { generateInstructionsContent, generateWrapperContent } from './opencode-content.js';
import { detectOwnership } from './opencode-ownership.js';
import { runtimeGuardFileUrl } from './opencode-runtime.js';
import { INSTRUCTION_ENTRY, INSTRUCTIONS_MARKER, MANAGED_RESOURCES, WRAPPER_MARKER, } from './opencode-types.js';
const PROFILE_METADATA = /^<!-- ChangeBudget-profile: ([^\s]+) -->$/;
export async function discoverManagedIntegration(projectRoot, changeBudgetRoot) {
    const instructionsPath = join(projectRoot, MANAGED_RESOURCES.instructions);
    const configPath = join(projectRoot, MANAGED_RESOURCES.opencodeConfig);
    const [instructionsState, wrapperState, configContent] = await Promise.all([
        detectOwnership(instructionsPath, INSTRUCTIONS_MARKER, generateInstructionsContent()),
        detectOwnership(join(projectRoot, MANAGED_RESOURCES.pluginWrapper), WRAPPER_MARKER, generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot))),
        readFile(configPath, 'utf8').catch((error) => {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }),
    ]);
    if (instructionsState === 'CONFLICT' || wrapperState === 'CONFLICT') {
        return { state: 'CONFLICT' };
    }
    let configEntryPresent = false;
    if (configContent !== undefined) {
        try {
            const config = parseOpenCodeConfig(configContent);
            if (config.instructions !== undefined && !Array.isArray(config.instructions)) {
                return { state: 'CONFLICT' };
            }
            configEntryPresent = config.instructions?.includes(INSTRUCTION_ENTRY) ?? false;
        }
        catch {
            return { state: 'CONFLICT' };
        }
    }
    if (instructionsState === 'MISSING') {
        if (wrapperState === 'MISSING' && !configEntryPresent)
            return { state: 'ABSENT' };
        return { state: 'PARTIAL', profileId: 'opencode' };
    }
    const instructions = await readFile(instructionsPath, 'utf8');
    const metadataLine = instructions.split('\n', 3)[1] ?? '';
    const profileMetadata = PROFILE_METADATA.exec(metadataLine);
    if (instructions.includes('ChangeBudget-profile:') && profileMetadata === null) {
        return { state: 'UNKNOWN_PROFILE', profileId: '' };
    }
    if (profileMetadata !== null && profileMetadata[1] !== 'opencode') {
        return { state: 'UNKNOWN_PROFILE', profileId: profileMetadata[1] ?? '' };
    }
    const profileId = 'opencode';
    if (wrapperState === 'MISSING' || configContent === undefined || !configEntryPresent) {
        return { state: 'PARTIAL', profileId };
    }
    if (profileMetadata === null) {
        return { state: 'LEGACY_MANAGED', profileId };
    }
    return {
        state: instructionsState === 'MANAGED_CURRENT' && wrapperState === 'MANAGED_CURRENT'
            ? 'MANAGED_CURRENT'
            : 'MANAGED_STALE',
        profileId,
    };
}
//# sourceMappingURL=opencode-discovery.js.map