# Internal Contract: Execution Gate

## Input

The pure evaluator receives the optional contract Envelope and either a declared fast-path operation or a normalized Material Decision. It has no Git, filesystem, network, framework-name, or provider dependency.

## Output

| Output | Meaning | Persistence |
|---|---|---|
| Non-material continuation | Declared structural fast-path operation | None |
| Invalid input error | Missing evidence, unknown authority-changing type, malformed authority, unavailable Envelope, identity conflict | None |
| Governance outcome | One of `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, `ESCALATE` | Material ledger |

## Runtime Boundary

While `OPEN`, the existing native Runtime Guard `permission.evaluate` hook may pass explicit structured Material Decision data to this evaluator before it assigns a permission effect; ordinary runtime contexts fabricate no decision and keep their established projection behavior. After `CONTRACT_SATISFIED`, every structurally valid operation reaches the post-satisfaction guard before materiality. Governance outcomes remain separate from Git Budget Engine results and plugin `allow`/`ask`/`block` actions.

While `OPEN`, `scope_expansion` outside ChangeContract path policy uses only existing ChangeContract policy and has no governance verdict. It never returns `ESCALATE` and never duplicates scope authority. While `OPEN`, `post_satisfaction_work` is structurally invalid and returns `INVALID_PROPOSAL` without a verdict or authority.

`changebudget start --execution-envelope-json '<JSON>'` accepts at most one non-null normalized Envelope object. Duplicate use, invalid JSON syntax, and any non-object JSON value produce the existing field/input validation failure (`InputValidationError`) at the input boundary and never reach the evaluator; absence is legacy behavior. `changebudget check --satisfaction-evidence-json '<JSON>'` accepts at most one object with `satisfied` criterion evidence items, rejects syntax and duplicate use at input, preserves legacy/read-only behavior when absent, and only advances satisfaction monotonically. There is no Material Decision CLI flag. Proposals use only native `permission.evaluate` -> Runtime Guard normalization -> evaluator -> projection.

## Evaluation Order

For an Envelope-enabled flow, the evaluator checks structural validity, the `CONTRACT_SATISFIED` post-satisfaction guard, materiality, and governance evaluation in that order. Structurally invalid proposals return `INVALID_PROPOSAL`, which is not a governance verdict, grants no authority, and applies even after satisfaction. After satisfaction, only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue without a governance verdict. Every other valid mutating or additional operation returns `BLOCK`, including normally non-material operations; materiality cannot bypass the guard.

## Compatibility

No Envelope means no governance evaluation. A governance result never changes the contract or lifecycle, and never redefines `PASS`, `REPAIR`, or `HUMAN_REVIEW`.

`CONTRACT_SATISFIED` is irreversible within the contract, and new work requires new explicit authority.
