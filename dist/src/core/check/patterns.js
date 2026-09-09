import { InputValidationError } from '../../models/errors.js';
const patternMatchers = new WeakMap();
function normalizePattern(pattern) {
    return pattern.trim().replace(/\\/g, '/');
}
function escapeRegexCharacter(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function parsePattern(value) {
    let index = 0;
    let source = '';
    const tokens = [];
    while (index < value.length) {
        const current = value[index];
        if (current === '*') {
            if (value[index + 1] === '*') {
                index += 2;
                while (value[index] === '*') {
                    index += 1;
                }
                source += '.*';
                tokens.push({ kind: 'globstar' });
                continue;
            }
            source += '[^/]*';
            tokens.push({ kind: 'star' });
            index += 1;
            continue;
        }
        if (current === '?') {
            source += '[^/]';
            tokens.push({ kind: 'question' });
            index += 1;
            continue;
        }
        if (current === '[') {
            const closingIndex = value.indexOf(']', index + 1);
            if (closingIndex === -1) {
                throw new InputValidationError(`Invalid path pattern: missing closing "]"`, 'path-pattern', {
                    pattern: value,
                    position: index,
                });
            }
            const body = value.slice(index + 1, closingIndex);
            if (!body.length) {
                throw new InputValidationError('Invalid path pattern: empty character class', 'path-pattern', {
                    pattern: value,
                });
            }
            const negated = body.startsWith('!') || body.startsWith('^');
            const classBody = body.slice(negated ? 1 : 0);
            if (classBody.includes('\n')) {
                throw new InputValidationError('Invalid path pattern: unsupported newline in character class', 'path-pattern', {
                    pattern: value,
                });
            }
            const escapedClassBody = classBody
                .split('').map((char) => (char === '\\' ? '\\' : char)).join('')
                .replace(/\^|\-|\]|\\/g, (segment) => `\\${segment}`);
            source += `[${negated ? '^' : ''}${escapedClassBody}]`;
            tokens.push({ kind: 'class', characters: classBody, negated });
            index = closingIndex + 1;
            continue;
        }
        if (current === '\\') {
            if (index + 1 >= value.length) {
                throw new InputValidationError('Invalid path pattern: trailing escape', 'path-pattern', {
                    pattern: value,
                });
            }
            source += escapeRegexCharacter(value[index + 1]);
            tokens.push({ kind: 'literal', value: value[index + 1] });
            index += 2;
            continue;
        }
        source += escapeRegexCharacter(current);
        tokens.push({ kind: 'literal', value: current });
        index += 1;
    }
    return { regexSource: source, tokens };
}
function addEmptyTransitions(states, tokens) {
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (states[index] && (token.kind === 'star' || token.kind === 'globstar')) {
            states[index + 1] = true;
        }
    }
}
function matchesCharacter(token, character) {
    switch (token.kind) {
        case 'literal':
            return token.value === character;
        case 'question':
            return character !== '/';
        case 'class':
            return token.negated ? !token.characters.includes(character) : token.characters.includes(character);
        case 'star':
        case 'globstar':
            return false;
    }
}
function matchesPath(path, matcher) {
    let states = new Array(matcher.tokens.length + 1).fill(false);
    for (let position = 0; position <= path.length; position += 1) {
        if (matcher.anchored ? position === 0 : position === 0 || path[position - 1] === '/') {
            states[0] = true;
        }
        addEmptyTransitions(states, matcher.tokens);
        if (states[matcher.tokens.length] && (matcher.anchored ? position === path.length : position === path.length || path[position] === '/')) {
            return true;
        }
        if (position === path.length) {
            return false;
        }
        const character = path[position];
        const nextStates = new Array(matcher.tokens.length + 1).fill(false);
        for (let index = 0; index < matcher.tokens.length; index += 1) {
            if (!states[index]) {
                continue;
            }
            const token = matcher.tokens[index];
            if (token.kind === 'globstar' || (token.kind === 'star' && character !== '/')) {
                nextStates[index] = true;
                continue;
            }
            if (matchesCharacter(token, character)) {
                nextStates[index + 1] = true;
            }
        }
        states = nextStates;
    }
    return false;
}
export function compilePathPatterns(patterns) {
    return patterns.map((pattern) => compilePathPattern(pattern));
}
export function compilePathPattern(pattern) {
    const normalized = normalizePattern(pattern);
    if (!normalized.length) {
        throw new InputValidationError('Path pattern cannot be empty', 'path-pattern', { pattern });
    }
    const anchored = normalized.startsWith('/');
    const body = anchored ? normalized.slice(1) : normalized;
    if (!body.length) {
        throw new InputValidationError('Path pattern cannot be only root', 'path-pattern', {
            pattern: normalized,
        });
    }
    const parsed = parsePattern(body);
    const source = anchored
        ? `^${parsed.regexSource}$`
        : `(?:^|/)${parsed.regexSource}(?:$|/)`;
    try {
        const compiled = {
            pattern: normalized,
            regex: new RegExp(source),
        };
        patternMatchers.set(compiled, { anchored, tokens: parsed.tokens });
        return compiled;
    }
    catch {
        throw new InputValidationError('Invalid path pattern', 'path-pattern', {
            pattern: normalized,
        });
    }
}
export function matchPathPattern(path, patterns) {
    const normalized = path.replace(/\\/g, '/');
    return patterns.some((entry) => {
        const matcher = patternMatchers.get(entry) ?? {
            anchored: entry.pattern.startsWith('/'),
            tokens: parsePattern(entry.pattern.startsWith('/') ? entry.pattern.slice(1) : entry.pattern).tokens,
        };
        return matchesPath(normalized, matcher);
    });
}
//# sourceMappingURL=patterns.js.map