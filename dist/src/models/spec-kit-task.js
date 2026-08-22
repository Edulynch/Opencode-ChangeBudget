export const TASK_ID_PATTERN = /^[Tt][0-9]{3,}$/;
export function isTaskIdInput(value) {
    return TASK_ID_PATTERN.test(value);
}
export function canonicalizeTaskId(value) {
    return value.toUpperCase();
}
//# sourceMappingURL=spec-kit-task.js.map