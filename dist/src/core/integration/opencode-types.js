/** Paths of the project-local files that ChangeBudget manages for OpenCode. */
export const MANAGED_RESOURCES = {
    pluginWrapper: '.opencode/plugins/changebudget.js',
    instructions: '.opencode/instructions/changebudget.md',
    opencodeConfig: 'opencode.json',
};
/** The exact entry string that ChangeBudget appends to `opencode.json`'s `instructions[]`. */
export const INSTRUCTION_ENTRY = '.opencode/instructions/changebudget.md';
/** Marker used to detect that a managed file belongs to ChangeBudget. */
export const OWNERSHIP_MARKER = 'ChangeBudget-managed';
/** Line-1 marker for the `.js` plugin wrapper. */
export const WRAPPER_MARKER = '// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode';
/** Line-1 marker for the `.md` instructions file. */
export const INSTRUCTIONS_MARKER = '<!-- ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode -->';
export const INSTRUCTIONS_PROFILE_METADATA = '<!-- ChangeBudget-profile:';
//# sourceMappingURL=opencode-types.js.map