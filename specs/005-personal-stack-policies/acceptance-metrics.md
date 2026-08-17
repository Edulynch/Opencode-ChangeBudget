# SPEC-005 Acceptance Metrics

Generated: 2026-08-17T06:08:41.375Z

| SC | Requirement | Observed | Result | Evidence |
| --- | --- | --- | --- | --- |
| SC-001 | For each supported stack, at least one deterministic sensitive category is resolved in at least 100 mixed checks/decisions | 100 mixed check scenarios | PASS | 100 scenarios (repair=76, pass=24), reason IDs observed=CBS-ANDROID-CONFIGURATION, CBS-ANDROID-DEPENDENCIES, CBS-ANDROID-SIGNING, CBS-FLUTTER-CONFIGURATION, CBS-FLUTTER-DEPENDENCIES, CBS-FLUTTER-RELEASE, CBS-NODE-TS-CONFIGURATION, CBS-NODE-TS-DEPENDENCIES, CBS-NODE-TS-PUBLIC-API, CBS-SPRING-BOOT-CONFIGURATION, CBS-SPRING-BOOT-DEPENDENCIES, CBS-SPRING-BOOT-MIGRATIONS |
| SC-002 | Repeated evaluation of the same repository, same contract, and same file set yields byte-stable output in at least 20 runs | 20 repeated runs | PASS | 20 runs compared after removing asOf; stable string length 493 |
| SC-003 | With only stack profile defaults, every edit matching a review rule emits the corresponding stack reason code | 12/12 matching edits emitted expected stack code | PASS | Coverage includes all 12 built-in deterministic stack rules. |
| SC-004 | In at least 90% of stack-sensitive scenarios, repository overrides lower false positives without reducing detection of high-impact changes | 20/20 false positives suppressed, 20/20 high-impact preserved | PASS | Repository-level disablement repeatedly removes the intended noisy rule and keeps high-impact rules active. |
| SC-005 | Contract-level rule disabling affects only the current contract in at least 20 independent contract cycles | 20/20 cycles suppressed, 20/20 adjacent contracts preserved | PASS | Each 2-contract cycle confirmed disabled-rule scope is contract-local. |
| SC-006 | Stack profile selection and override resolution complete within existing command timeout in non-interactive mode | start max=523.04ms avg=290.67ms, check max=515.21ms avg=413.77ms | PASS | All start and check commands stayed below 3000ms threshold in local runs. |
