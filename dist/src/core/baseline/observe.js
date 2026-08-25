import { GitOutputError } from '../../models/errors.js';
import { normalizeRepositoryPath } from './path-identity.js';
function malformed(recordIndex, message, record) {
    throw new GitOutputError(`Malformed git observation record: ${message}`, {
        recordIndex,
        excerpt: record.replace(/[\0\r\n]/g, ' ').slice(0, 80),
    });
}
function splitFields(record, fieldCount, recordIndex) {
    const fields = [];
    let start = 0;
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
        const end = record.indexOf(' ', start);
        if (end < 0) {
            return malformed(recordIndex, 'missing required fields', record);
        }
        fields.push(record.slice(start, end));
        start = end + 1;
    }
    const finalField = record.slice(start);
    if (!finalField) {
        return malformed(recordIndex, 'missing path', record);
    }
    fields.push(finalField);
    return fields;
}
function isMode(value) {
    return /^[0-7]{6}$/.test(value);
}
function objectTypeForMode(mode, recordIndex, record) {
    if (mode === '120000')
        return 'symlink';
    if (mode === '160000')
        return 'gitlink';
    if (mode === '040000')
        return 'directory';
    if (/^100[0-7]{3}$/.test(mode))
        return 'file';
    return malformed(recordIndex, 'unsupported file mode', record);
}
function parseStatusPair(value, recordIndex, record) {
    if (!/^[.MADRCU][.MADRCU]$/.test(value)) {
        return malformed(recordIndex, 'invalid index/worktree status', record);
    }
    return [value[0], value[1]];
}
function parseTrackedRecord(record, recordIndex, binaryPaths) {
    const fields = splitFields(record, 8, recordIndex);
    const status = parseStatusPair(fields[1], recordIndex, record);
    const modes = [fields[3], fields[4], fields[5]];
    if (!modes.every(isMode)) {
        return malformed(recordIndex, 'invalid mode', record);
    }
    const path = normalizeRepositoryPath(fields[8]);
    const deleted = status[0] === 'D' || status[1] === 'D';
    const mode = deleted ? null : modes[2];
    return {
        path,
        tracked: true,
        staged: status[0] !== '.',
        unstaged: status[1] !== '.',
        untracked: false,
        deleted,
        renamed: status[0] === 'R' || status[1] === 'R',
        copied: status[0] === 'C' || status[1] === 'C',
        isBinary: binaryPaths.has(path),
        mode,
        objectType: mode === null ? objectTypeForMode(modes[1], recordIndex, record) : objectTypeForMode(mode, recordIndex, record),
    };
}
function parseRenameOrCopyRecord(record, sourcePath, recordIndex, binaryPaths) {
    if (!sourcePath)
        return malformed(recordIndex, 'missing rename or copy source path', record);
    const fields = splitFields(record, 9, recordIndex);
    const status = parseStatusPair(fields[1], recordIndex, record);
    const modes = [fields[3], fields[4], fields[5]];
    if (!modes.every(isMode) || !/^[RC]\d+$/.test(fields[8])) {
        return malformed(recordIndex, 'invalid rename or copy metadata', record);
    }
    const path = normalizeRepositoryPath(fields[9]);
    const normalizedSourcePath = normalizeRepositoryPath(sourcePath);
    const copied = fields[8].startsWith('C');
    return {
        path,
        sourcePath: normalizedSourcePath,
        tracked: true,
        staged: status[0] !== '.',
        unstaged: status[1] !== '.',
        untracked: false,
        deleted: status[0] === 'D' || status[1] === 'D',
        renamed: !copied,
        copied,
        isBinary: binaryPaths.has(path) || binaryPaths.has(normalizedSourcePath),
        mode: modes[2],
        objectType: objectTypeForMode(modes[2], recordIndex, record),
    };
}
export function parseGitObservationZOutput(input) {
    const binaryPaths = new Set((input.binaryPaths ?? []).map(normalizeRepositoryPath));
    const records = [];
    const chunks = input.statusOutput.split('\0');
    for (let index = 0; index < chunks.length; index += 1) {
        const record = chunks[index] ?? '';
        if (!record) {
            if (index === chunks.length - 1)
                continue;
            return malformed(index, 'unexpected empty record', record);
        }
        if (record.startsWith('1 ')) {
            records.push(parseTrackedRecord(record, index, binaryPaths));
            continue;
        }
        if (record.startsWith('2 ')) {
            const sourcePath = chunks[index + 1];
            records.push(parseRenameOrCopyRecord(record, sourcePath, index, binaryPaths));
            index += 1;
            continue;
        }
        if (record.startsWith('? ')) {
            const path = normalizeRepositoryPath(record.slice(2));
            records.push({
                path,
                tracked: false,
                staged: false,
                unstaged: false,
                untracked: true,
                deleted: false,
                renamed: false,
                copied: false,
                isBinary: binaryPaths.has(path),
                mode: null,
                objectType: 'file',
            });
            continue;
        }
        return malformed(index, 'unsupported status record kind', record);
    }
    return records;
}
//# sourceMappingURL=observe.js.map