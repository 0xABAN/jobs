# Application optimizations

Fireworks baseline: 17 minutes (user-reported, with Jobright autofill). The first application under `src/core/apply.md`, without Jobright, sets the new baseline.

## Next application

- Time from the first application-specific action through verified submission and Apps-sheet logging. Record total time and time spent on eligibility/duplicate checks, form completion, and submission/logging.
- Verify the company and role in the active form before interacting with Apply.
- Check required fields in the employer's form itself (`states.required` in the snapshot), not a progress indicator.
- Verify the employer's success confirmation and the Apps-sheet row before finishing.
