export const INTEGRATION_PROFILES = [
    { id: 'opencode' },
];
/** Return a profile only when the user-provided target is an exact registered ID. */
export function getIntegrationProfile(target) {
    return INTEGRATION_PROFILES.find((profile) => profile.id === target);
}
//# sourceMappingURL=profiles.js.map