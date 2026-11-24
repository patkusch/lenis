# Working in lenis

A voice-guided calming companion — EMDR-style bilateral stimulation that sets its pace from the sound of your voice, not a slider. Runs entirely in the browser; your audio never leaves the device.

## Run the tests

You need Node 22 or newer.

```bash
npm ci
npm test
```

Every test should pass before you start and after you finish.

## Where things are

- `src/`: the code
- `tests/`: the tests
- `docs/`: written documentation

## Before you commit

- Make sure the tests pass.
- Put changes people will notice in `CHANGELOG.md`.
- Do not put real passwords, keys or private data in test files or examples. Use made-up ones.
