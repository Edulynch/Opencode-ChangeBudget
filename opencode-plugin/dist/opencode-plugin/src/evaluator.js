import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const runtimeSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../dist/src');
const [checkModule, stateModule, contractModule] = await Promise.all([
    import(pathToFileURL(join(runtimeSourceRoot, 'cli/commands/check.js')).href),
    import(pathToFileURL(join(runtimeSourceRoot, 'core/state/state.js')).href),
    import(pathToFileURL(join(runtimeSourceRoot, 'core/state/contracts.js')).href),
]);
const { runCheck } = checkModule;
const { readLifecycleState } = stateModule;
const { resolveActiveContract } = contractModule;
function normalizeStringList(value, field) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry, index) => entry.length > 0 && typeof value[index] === 'string');
}
function toRuntimeContractSnapshot(contract) {
    return {
        contract_id: contract.id,
        task_description: contract.task_description ?? '<missing task description>',
        base_revision: contract.base_revision ?? '<missing base revision>',
        allow_paths: normalizeStringList(contract.allow_paths, 'allow_paths'),
        deny_paths: normalizeStringList(contract.deny_paths, 'deny_paths'),
        allow_new_files: contract.allow_new_files,
        allow_new_dependencies: !!contract.allow_new_dependencies,
        allow_migrations: !!contract.allow_migrations,
        allow_config_changes: !!contract.allow_config_changes,
        allow_public_api_changes: !!contract.allow_public_api_changes,
    };
}
export async function evaluateRuntimeDecision(repositoryRoot) {
    let state;
    try {
        state = await readLifecycleState(repositoryRoot);
    }
    catch {
        return {
            isInited: true,
            policyDecision: 'HUMAN_REVIEW',
            contractId: null,
            contract: null,
        };
    }
    if (!state || state.lifecycle_state === 'uninitialized') {
        return {
            isInited: false,
            policyDecision: 'PASS',
            contractId: state?.active_contract_id ?? null,
            contract: null,
        };
    }
    if (!state.active_contract_id) {
        return {
            isInited: true,
            policyDecision: 'PASS',
            contractId: null,
            contract: null,
        };
    }
    try {
        const checkResult = await runCheck(repositoryRoot, []);
        let contract = null;
        try {
            contract = await resolveActiveContract(repositoryRoot, state);
        }
        catch {
            contract = null;
        }
        return {
            isInited: true,
            policyDecision: checkResult.decision,
            contractId: state.active_contract_id,
            contract: contract ? toRuntimeContractSnapshot(contract) : null,
        };
    }
    catch {
        return {
            isInited: true,
            policyDecision: 'HUMAN_REVIEW',
            contractId: state.active_contract_id,
            contract: null,
        };
    }
}
//# sourceMappingURL=evaluator.js.map