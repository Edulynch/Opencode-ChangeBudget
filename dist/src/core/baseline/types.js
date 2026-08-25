export const COMPARISON_MODES = ['baseline', 'legacy'];
export const BASELINE_STATES = ['captured', 'legacy', 'unavailable', 'invalid', 'incompatible'];
export const BASELINE_EVIDENCE_STATES = [
    'valid',
    'legacy',
    'missing',
    'corrupt',
    'mismatched',
    'unsupported',
    'ambiguous',
    'unstable',
    'unavailable',
    'dirty-submodule',
];
export const BASELINE_REASON_CODES = [
    'BASELINE_REQUIRED_MISSING',
    'BASELINE_CORRUPT',
    'BASELINE_MISMATCH',
    'BASELINE_UNSUPPORTED',
    'BASELINE_PATH_AMBIGUITY',
    'BASELINE_HEAD_MOVED',
    'BASELINE_UNSTABLE_CAPTURE',
    'BASELINE_SUBMODULE_DIRTY',
];
export const BASELINE_OBJECT_TYPES = ['file', 'directory', 'symlink', 'gitlink', 'other'];
//# sourceMappingURL=types.js.map