# SPEC-006 Acceptance Metrics

Generated: 2026-08-18T08:12:20.092Z

| SC | Requirement | Observed | Result | Evidence |
| --- | --- | --- | --- | --- |
| SC-001 | In at least 50 mixed start → status → check → close scenarios on task-tied contracts, the task ID, title, source feature, and source path are retained and reported identically at every stage | 50 mixed task-tied lifecycle scenarios | PASS | task_id/title/source_feature/source_path identical across persisted contract, status Task:/Source: lines, check --json task object, and close output in all 50 scenarios. |
| SC-002 | In at least 20 scenarios, an unknown task ID fails with the same deterministic error and leaves lifecycle state byte-identical to before the command | 20 unknown-ID runs | PASS | Each run exited 2 with the identical InputValidationError "not found" message and left .changebudget/ byte-identical. |
| SC-003 | In at least 20 scenarios, an ambiguous (duplicate) task ID fails deterministically listing every source, with zero guessed resolutions | 20 ambiguous-ID runs | PASS | Each run exited 2 with the identical ambiguity error listing both source paths, no guessed resolution, and .changebudget/ byte-identical. |
| SC-004 | For repositories without Spec-Kit structure and for task-free start calls, 100% of outputs and persisted contracts are identical to the SPEC-001..005 baseline | 20/20 task-free lifecycle scenarios byte-identical to baseline | PASS | No-Spec-Kit fixtures produced no task lines, no task key in check --json, null task fields on the persisted contract, and exact "Contract closed." close output in every scenario. |
| SC-005 | In at least 20 task-based start runs, git status --short and tasks.md content are byte-identical before and after the command (read-only guarantee) | 20 task-based read-only start runs | PASS | git status --porcelain=v1 and tasks.md bytes were identical before and after every task-based start. |
| SC-006 | The fast path changebudget start T031 --tiny → check → close completes with no tasks.md changes, no completion marking, and no Spec-Kit ceremony | 20 fast-path scenarios (start → check → close) | PASS | Every fast-path cycle exited 0 with decision PASS, identical task metadata in check --json, tasks.md unchanged with no completion marking, and no git or Spec-Kit ceremony. |
