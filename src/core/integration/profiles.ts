/** A closed descriptor for a supported project integration target. */
export type IntegrationProfile = {
  readonly id: 'opencode';
};

export const INTEGRATION_PROFILES = [
  { id: 'opencode' },
] as const satisfies readonly IntegrationProfile[];

export type IntegrationProfileId = (typeof INTEGRATION_PROFILES)[number]['id'];

/** Return a profile only when the user-provided target is an exact registered ID. */
export function getIntegrationProfile(target: string): IntegrationProfile | undefined {
  return INTEGRATION_PROFILES.find((profile) => profile.id === target);
}
