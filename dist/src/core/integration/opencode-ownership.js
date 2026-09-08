import { readFile } from 'node:fs/promises';
/** Classify a file's ownership state from its exact first line and content. */
export async function detectOwnership(filePath, expectedMarker, expectedContent) {
    let content;
    try {
        content = await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return 'MISSING';
        }
        throw error;
    }
    const firstLine = content.split('\n', 1)[0] ?? '';
    if (firstLine !== expectedMarker) {
        return 'CONFLICT';
    }
    return content === expectedContent ? 'MANAGED_CURRENT' : 'MANAGED_STALE';
}
/** Classify a file's ownership state for removal using its exact first line. */
export async function detectOwnershipForRemoval(filePath, expectedMarker) {
    let content;
    try {
        content = await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return 'MISSING';
        }
        throw error;
    }
    const firstLine = content.split('\n', 1)[0] ?? '';
    return firstLine === expectedMarker ? 'MANAGED_CURRENT' : 'CONFLICT';
}
//# sourceMappingURL=opencode-ownership.js.map