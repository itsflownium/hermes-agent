# OpenBot backend evaluation

This extends the earlier discovery/store/probe comparison through OpenBot's real
agent service, provider driver, SQLite persistence and its pinned Pi executable.
It does not test the desktop UI or use paid inference. No OpenBot production
implementation is copied into Hermes or replaced with a mock.

## Boundaries and fixed protocol

OpenBot source is `f91535fb0c8d6fd0a63911ec6e4b67154fd85ebe`, exported from Git.
Use its exact native-runtime-lock binaries: Bun 1.4.4 and Pi 1.1.0 on macOS arm64.
Verify the release archive/binary SHA-256 values before executing them. Install
the required backend import graph in a separate runtime with package scripts
disabled; workspace links point to the unchanged external source archive.

First run these unchanged upstream scripts sequentially, retaining each native
report: provider conformance, recorded transcript replay, stuck-delivery recovery,
provider-exit/session handling and Pi steering. These scripts supply controlled
provider processes; their assertions belong to OpenBot. Report the supported and
uncovered providers explicitly, without turning a script count into a task score.

The matched artifact phase uses actual AIAgent/file tools for Hermes, and actual
AgentService/PiAgentClient/Pi file tools for OpenBot. Both use the same local HTTP
server with predeclared response sequences. The endpoint generates OpenAI-format
responses; it does not call an inference provider. The tool-name mapping is
`write_file`/`read_file` for Hermes and `write`/`read` for Pi, with the same logical
relative paths and file bytes. Each arm gets its normal prompt/tool surface for
this test; these are different implementations, not identical model contexts.

Neither arm gets a preloaded checklist or an injected checklist tool call.
Hermes's checklist tool remains available. These cases therefore do not repeat
the favorable prerequisite in the earlier Hermes-only completion fixtures.

| Fixed case | Supplied response sequence | Acceptance oracle |
|---|---|---|
| Complete files | Write report, write attachment, final answer | Exact bytes REPORT and ATTACHMENT |
| Premature final | Write report, premature final; attachment write available only if runtime continues | Both exact files exist when the accepted user turn ends |
| Blocked | Explain missing input | No fabricated files; blocker stated |
| Cancelled | Acknowledge user's cancellation | No output files; cancellation stated |
| Status only | Read an existing report, answer | ORIGINAL bytes unchanged; no attachment created |
| File-write recovery | Write to an existing directory (error), correct path, write both files, final | Error visible in the tool result and both exact output files |

Run each case in each arm in three fresh processes, sequentially in a fixed
shuffled order (seed 20261027): 36 planned launches. A run checkpoints its complete
plan and each admission before execution. Keep timeouts, errors and failed
contracts; there is no best-of selection or file retry. The worker deadline is
100 seconds, with an 80-second inner OpenBot process bound. A fixture that invokes
an unadvertised tool is a setup error, not an agent task failure.

Record observed file bytes, saved final responses, queue/turn outcomes, request
counts, tool results, request/message/schema hashes and all launches. Omit HTTP
authorization headers and production system-prompt text. This preserves the
observations and provenance without publishing credentials or redistributing
OpenBot's prompt content. Runtime state stays in temporary directories.

These are authored, unblinded fault/contract cases. Scripted responses test runtime
behavior, not a model's ability to choose actions, search, reason or solve a user
task. Provider-native work differs from a Hermes model/tool loop. Request counts
are diagnostic, not a comparable dollar-cost or latency ranking. Report each case
and every unsupported area; do not combine these with search into an overall bot
score. The test does not establish which product is best.

## Setup diagnostics

The initial local Bun 1.3.14 could not load `node:sqlite`; five script launches
failed before their tests started and produced no reports. Retain these as setup
diagnostics. The compatible pinned Bun is required for the measured upstream run.
An adapter pilot with an empty initial message was refused by the real service;
the adapter uses its required initial-message creation flow before graded runs.
