import { collectObservableSignals } from '../../core/diagnose/collect.js';
import { evaluateRecommendation } from '../../core/diagnose/advisor.js';
import { parseDiagnoseArgs } from '../parsers/diagnose-input.js';
import { resolveSpecKitTask } from '../../core/spec-kit/tasks.js';
export async function runDiagnose(repositoryRoot, args) {
    const input = parseDiagnoseArgs(args);
    let taskResolution = null;
    if (input.task_id !== null) {
        taskResolution = await resolveSpecKitTask(repositoryRoot, input.task_id);
    }
    const signals = await collectObservableSignals(repositoryRoot, input, taskResolution);
    return evaluateRecommendation(signals, input);
}
//# sourceMappingURL=diagnose.js.map