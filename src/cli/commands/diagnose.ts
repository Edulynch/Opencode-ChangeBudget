import { DiagnoseInput, DiagnosisResult } from '../../models/diagnose.js';
import { collectObservableSignals } from '../../core/diagnose/collect.js';
import { evaluateRecommendation } from '../../core/diagnose/advisor.js';
import { parseDiagnoseArgs } from '../parsers/diagnose-input.js';

export async function runDiagnose(repositoryRoot: string, args: string[]): Promise<DiagnosisResult> {
  const input: DiagnoseInput = parseDiagnoseArgs(args);
  const signals = await collectObservableSignals(repositoryRoot, input, null);
  return evaluateRecommendation(signals, input);
}
