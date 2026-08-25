export function selectEvidence(observation, gitReference, privatePayload) {
    if (gitReference !== null && !observation.unstaged && !observation.untracked) {
        return { kind: 'git', reference: gitReference };
    }
    if (privatePayload !== null)
        return { kind: 'private', payload: privatePayload };
    return null;
}
//# sourceMappingURL=evidence.js.map