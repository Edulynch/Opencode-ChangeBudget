import { resolveActiveContract, readContract } from '../../core/state/contracts.js';
import { readLifecycleState } from '../../core/state/state.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { GitEnvironmentError, IOStateError, InputValidationError, StateCorruptionError, } from '../../models/errors.js';
import { runCheck } from './check.js';
function getContractForState(repositoryRoot, lifecycleState) {
    return resolveActiveContract(repositoryRoot, lifecycleState);
}
async function getLastClosedContract(repositoryRoot, lifecycleState) {
    if (!lifecycleState.last_closed_contract_id) {
        return null;
    }
    return readContract(repositoryRoot, lifecycleState.last_closed_contract_id);
}
function parseStatusArgs(args) {
    let budget = false;
    let json = false;
    for (const token of args) {
        if (token === '--budget') {
            budget = true;
            continue;
        }
        if (token === '--json') {
            json = true;
            continue;
        }
        if (token.startsWith('--json=')) {
            const value = token.slice('--json='.length).toLowerCase();
            if (value.length === 0) {
                throw new InputValidationError('Invalid value for --json', 'json');
            }
            if (value !== 'true' && value !== 'false') {
                throw new InputValidationError('Invalid value for --json', 'json', { value: token.slice('--json='.length) });
            }
            json = value === 'true';
            continue;
        }
        throw new InputValidationError('status does not accept arguments', 'argument', {
            args,
        });
    }
    if (json && !budget) {
        throw new InputValidationError('status --json requires --budget', 'json', {
            args,
        });
    }
    return { budget, json };
}
function mapBudgetFailureReasonCode(error) {
    if (error instanceof InputValidationError) {
        return 'CBV-INPUT-INVALID';
    }
    if (error instanceof GitEnvironmentError) {
        const context = error.context;
        if (context?.reason === 'unresolved') {
            return 'CBV-BASE-REVISION-UNKNOWN';
        }
        return 'CBV-ENV-NOT-READY';
    }
    if (error instanceof StateCorruptionError || error instanceof IOStateError) {
        return 'CBV-RULE-CONFIG-INVALID';
    }
    return 'CBV-ENV-NOT-READY';
}
function buildFailureBudgetResult(contractId, baseRevision, reasonCode, message) {
    return {
        contractSource: 'active',
        contractId,
        baseRevision,
        changedFileCount: 0,
        changedLinesCount: 0,
        binaryChangeCount: 0,
        newFileCount: 0,
        deletedFileCount: 0,
        renamedFileCount: 0,
        pathRuleResults: [],
        limitResults: [],
        violations: [
            {
                rule: 'max_files',
                message,
                reasonCode,
                action: 'review',
            },
        ],
        status: 'FAIL',
        decision: 'HUMAN_REVIEW',
        reasonCodes: [reasonCode],
        asOf: new Date().toISOString(),
    };
}
function buildStatusResultErrorBase(lifecycleState, budgetRequested, budgetJson, repositoryRoot) {
    return {
        repositoryRoot,
        lifecycleState,
        activeContract: null,
        lastClosedContract: null,
        budgetRequested,
        budgetJson,
        budgetResult: null,
    };
}
function describeErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unable to evaluate budget status.';
}
function toBaseRevision(activeContract) {
    return activeContract?.base_revision ?? 'unknown';
}
function getLastClosedContractForStatus(repositoryRoot, lifecycleState, activeContract) {
    return lifecycleState.lifecycle_state !== 'active' || !activeContract
        ? getLastClosedContract(repositoryRoot, lifecycleState)
        : Promise.resolve(null);
}
function parseStatusBaseErrorContractMessage(activeContractId) {
    if (activeContractId) {
        return `Unable to evaluate budget for active contract ${activeContractId}.`;
    }
    return 'Unable to evaluate budget without an active contract.';
}
export async function runStatus(repositoryRootHint = process.cwd(), args = []) {
    const parsed = parseStatusArgs(args);
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const lifecycleState = await readLifecycleState(repositoryRoot);
    if (!lifecycleState) {
        const baseResult = buildStatusResultErrorBase(null, parsed.budget, parsed.json, repositoryRoot);
        if (!parsed.budget) {
            return baseResult;
        }
        return {
            ...baseResult,
            budgetResult: buildFailureBudgetResult(null, 'unknown', 'CBV-INPUT-INVALID', 'No lifecycle state exists in this repository.'),
        };
    }
    let activeContract = null;
    if (lifecycleState.active_contract_id) {
        try {
            activeContract = await getContractForState(repositoryRoot, lifecycleState);
        }
        catch (error) {
            if (error instanceof IOStateError || error instanceof StateCorruptionError) {
                throw error;
            }
            if (!parsed.budget) {
                throw error;
            }
            return {
                repositoryRoot,
                lifecycleState,
                activeContract: null,
                lastClosedContract: await getLastClosedContract(repositoryRoot, lifecycleState),
                budgetRequested: true,
                budgetJson: parsed.json,
                budgetResult: buildFailureBudgetResult(lifecycleState.active_contract_id, 'unknown', mapBudgetFailureReasonCode(error), parseStatusBaseErrorContractMessage(lifecycleState.active_contract_id)),
            };
        }
    }
    const lastClosedContract = await getLastClosedContractForStatus(repositoryRoot, lifecycleState, activeContract);
    if (!parsed.budget) {
        return {
            repositoryRoot,
            lifecycleState,
            activeContract,
            lastClosedContract,
            budgetRequested: false,
            budgetJson: parsed.json,
            budgetResult: null,
        };
    }
    if (!activeContract) {
        return {
            repositoryRoot,
            lifecycleState,
            activeContract,
            lastClosedContract,
            budgetRequested: true,
            budgetJson: parsed.json,
            budgetResult: buildFailureBudgetResult(lifecycleState.active_contract_id, 'unknown', 'CBV-INPUT-INVALID', parseStatusBaseErrorContractMessage(lifecycleState.active_contract_id)),
        };
    }
    try {
        const budgetResult = await runCheck(repositoryRoot, []);
        return {
            repositoryRoot,
            lifecycleState,
            activeContract,
            lastClosedContract,
            budgetRequested: true,
            budgetJson: parsed.json,
            budgetResult,
        };
    }
    catch (error) {
        return {
            repositoryRoot,
            lifecycleState,
            activeContract,
            lastClosedContract,
            budgetRequested: true,
            budgetJson: parsed.json,
            budgetResult: buildFailureBudgetResult(activeContract.id, toBaseRevision(activeContract), mapBudgetFailureReasonCode(error), `${parseStatusBaseErrorContractMessage(activeContract.id)} ${describeErrorMessage(error)}`),
        };
    }
}
//# sourceMappingURL=status.js.map