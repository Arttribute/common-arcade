---
'@common-arcade/control-client': minor
'@common-arcade/sdk': minor
'@common-arcade/cli': minor
---

Make testing genre-agnostic. `testRuntime` now returns a typed `RuntimeTestResult` for every game with authoritative rules, including `requestedSteps` and `truncated` when a long game stops within the test budget. The grid-only Test Arena run loop is removed: `createTestRun`, `getTestRun`, `stepTestRun`, `getTestDiagnostics`, `createProjectRun`, `stepProjectRun` and the `TestRun`, `CreateTestRunInput` and `DiagnosticList` types are gone from the client and SDK, and the CLI's `test run` and `test logs` commands are replaced by `arcade projects test <id> [--file] [--steps] [--seed]`.
