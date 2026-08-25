import { createHash } from 'node:crypto';
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value === null || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, stableValue(item)]));
}
function digest(input) {
    return createHash('sha256').update(JSON.stringify(stableValue(input))).digest('hex');
}
export function digestContent(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
export function createEvidenceDescriptor(input) {
    return { ...input, integrity: digest(input) };
}
export function verifyEvidenceDescriptor(evidence) {
    const { integrity: _integrity, ...input } = evidence;
    return { evidenceState: digest(input) === evidence.integrity ? 'valid' : 'corrupt' };
}
//# sourceMappingURL=integrity.js.map