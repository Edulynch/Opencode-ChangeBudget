import { createHash } from 'node:crypto';
function digest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function entryEquals(entry, current) {
    if (entry.observation.deleted)
        return current === null;
    return current !== null
        && entry.objectType === current.objectType
        && entry.mode === current.mode
        && entry.contentDigest !== null
        && digest(current.bytes) === entry.contentDigest;
}
export function projectBaselineChanges(evidence, currentItems, currentValues) {
    const projected = new Map(currentItems.map((item) => [item.path, item]));
    let excludedUnchangedCount = 0;
    let stagingTransitionCount = 0;
    for (const entry of evidence.entries) {
        if (!currentValues.has(entry.path))
            return { ok: false, reasonCode: 'BASELINE_REQUIRED_MISSING' };
        const current = currentValues.get(entry.path) ?? null;
        if (!entryEquals(entry, current)) {
            if (!projected.has(entry.path)) {
                projected.set(entry.path, {
                    path: entry.path,
                    type: current === null ? 'deleted' : 'modified',
                    addedLines: 0,
                    removedLines: 0,
                    isBinary: entry.observation.isBinary || current?.bytes.includes(0) === true,
                    staged: false,
                });
            }
            continue;
        }
        const item = projected.get(entry.path);
        if (item) {
            projected.delete(entry.path);
            excludedUnchangedCount += 1;
            if (item.staged !== entry.observation.staged)
                stagingTransitionCount += 1;
        }
    }
    return {
        ok: true,
        items: [...projected.values()],
        excludedUnchangedCount,
        stagingTransitionCount,
    };
}
//# sourceMappingURL=compare.js.map