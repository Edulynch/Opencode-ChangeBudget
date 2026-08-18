import { DiagnoseInput, DiagnosisResult } from '../../models/diagnose.js';
import { collectObservableSignals } from '../../core/diagnose/collect.js';
import { evaluateRecommendation } from '../../core/diagnose/advisor.js';
import { parseDiagnoseArgs } from '../parsers/diagnose-input.js';
import { resolveSpecKitTask } from '../../core/spec-kit/tasks.js';
import { SpecKitTaskResolution } from '../../models/spec-kit-task.js';

export async function runDiagnose(repositoryRoot: string, args: string[]): Promise<DiagnosisResult> {
  const input: DiagnoseInput = parseDiagnoseArgs(args);

  let taskResolution: SpecKitTaskResolution | null = null;
  if (input.task_id !== null) {
    taskResolution = await resolveSpecKitTask(repositoryRoot, input.task_id);
  }

  const signals = await collectObservableSignals(repositoryRoot, input, taskResolution);
  return evaluateRecommendation(signals, input);
}