export const CURRENT_SCHEMA_VERSION = '1.0.0';
export const LIFECYCLE_STATES = [
    'uninitialized',
    'initialized',
    'active',
    'closed',
];
export const LIFECYCLE_AUDIT_OPERATIONS = [
    'init',
    'start',
    'amend',
    'close',
    'native_grant_admin',
];
export function isLifecycleState(value) {
    return LIFECYCLE_STATES.includes(value);
}
//# sourceMappingURL=lifecycle-state.js.map