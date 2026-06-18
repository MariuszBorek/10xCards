## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

### Correctness

Whether the diff actually does what its title and description claim, without introducing logic errors or regressions. **1** = obvious bugs, broken logic, or behavior that contradicts the stated intent; **10** = logically sound, fully delivers its stated purpose, no detectable regressions.

### Security

Whether the change avoids introducing vulnerabilities such as injection, missing authz/RLS, leaked secrets, or unsafe input handling. **1** = introduces an exploitable flaw or exposes sensitive data; **10** = no new attack surface, inputs validated, secrets and access controls handled correctly.

### Error handling & edge cases

Whether failure paths, empty/boundary inputs, and unexpected states are anticipated and handled gracefully. **1** = happy-path only, swallows or ignores errors, crashes on edge cases; **10** = failure modes are caught, surfaced meaningfully, and edge cases are covered.

### Readability & maintainability

Whether the code is clear, well-named, and easy for the next developer to understand and change. **1** = cryptic naming, tangled control flow, duplicated or dead code; **10** = self-explanatory, well-structured, easy to extend or modify safely.

### Test coverage

Whether the change is accompanied by tests proportionate to its risk and complexity. **1** = risky logic shipped with no tests; **10** = meaningful tests covering the new behavior and its important edge cases.

### Performance & efficiency

Whether the change avoids needless work, inefficient algorithms, or resource leaks given its context. **1** = clear performance regressions, N+1 patterns, or unbounded resource use; **10** = efficient for the expected workload with no wasteful operations.

### Consistency with conventions

Whether the diff follows the project's established patterns, style, and idioms as visible in the surrounding code. **1** = ignores existing conventions, mixes styles, reinvents existing helpers; **10** = blends in seamlessly with the codebase's established patterns.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
