export const EXECUTION_CONSTRAINTS = ['HARD', 'SOFT'];
export const MATERIAL_DECISION_KINDS = [
    'scope_expansion',
    'delegated_agent',
    'concurrent_worker',
    'reasoning_escalation',
    'research_expansion',
    'architecture_review',
    'verification_expansion',
    'documentation_expansion',
    'infrastructure_expansion',
    'external_service',
    'post_satisfaction_work',
];
export const NUMERIC_MATERIAL_DECISION_KINDS = [
    'delegated_agent',
    'concurrent_worker',
];
export const ALLOWLIST_MATERIAL_DECISION_KINDS = [
    'reasoning_escalation',
    'research_expansion',
    'architecture_review',
    'verification_expansion',
    'documentation_expansion',
    'infrastructure_expansion',
    'external_service',
];
export const SATISFACTION_STATES = ['OPEN', 'CONTRACT_SATISFIED'];
export const GOVERNANCE_VERDICTS = [
    'APPROVE',
    'REDUCE',
    'REPLACE',
    'DEFER',
    'BLOCK',
    'ESCALATE',
];
export const NECESSITY_LEVELS = ['optional', 'required'];
export const POST_SATISFACTION_OPERATIONS = [
    'read_only',
    'introspection',
    'authorized_validation',
    'changebudget_check',
    'incidental_cleanup',
    'normal_close',
];
//# sourceMappingURL=execution-gate.js.map