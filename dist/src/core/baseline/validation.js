import { findPathIdentityAmbiguities, normalizeRepositoryPath } from './path-identity.js';
import { digestContent, verifyEvidenceDescriptor } from './integrity.js';
function invalid(reasonCode, baselineState = 'invalid') {
    return { comparisonMode: 'baseline', baselineState, decision: 'HUMAN_REVIEW', reasonCodes: [reasonCode] };
}
export function validateBaselineEvidence(contract, evidence, identityOptions) {
    if (contract.comparison_mode !== 'baseline' || !contract.baseline_ref || !contract.activation_head)
        return invalid('BASELINE_REQUIRED_MISSING', 'unavailable');
    if (evidence.schemaVersion !== 1)
        return invalid('BASELINE_UNSUPPORTED', 'incompatible');
    if (evidence.contractId !== contract.id || evidence.activationHead !== contract.activation_head)
        return invalid('BASELINE_MISMATCH');
    try {
        const paths = evidence.entries.map((entry) => normalizeRepositoryPath(entry.path));
        if (new Set(paths).size !== paths.length || findPathIdentityAmbiguities(paths, identityOptions).length > 0)
            return invalid('BASELINE_PATH_AMBIGUITY');
        for (const entry of evidence.entries) {
            if (entry.objectType !== 'file' && entry.objectType !== 'symlink' && entry.objectType !== 'gitlink')
                return invalid('BASELINE_UNSUPPORTED', 'incompatible');
            if (entry.observation.deleted)
                continue;
            if (entry.payload === null || entry.contentDigest === null)
                return invalid('BASELINE_REQUIRED_MISSING', 'unavailable');
            if (digestContent(Buffer.from(entry.payload, 'base64')) !== entry.contentDigest)
                return invalid('BASELINE_CORRUPT');
        }
    }
    catch {
        return invalid('BASELINE_PATH_AMBIGUITY');
    }
    if (verifyEvidenceDescriptor(evidence).evidenceState !== 'valid')
        return invalid('BASELINE_CORRUPT');
    return { comparisonMode: 'baseline', baselineState: 'captured', decision: 'PASS', reasonCodes: [] };
}
//# sourceMappingURL=validation.js.map