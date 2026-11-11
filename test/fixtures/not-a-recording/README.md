# not-a-recording

Hand-made test data for the recipe-reader spec. These are **not** recordings: nothing here
came from the model, and `npm run record` never touches this directory. The `model` field
of both recordings says `hand-made-not-a-recording`. Server tests use this fixture so that
they run without a key and before the first real recording exists; the real recordings live
in `recordings/` at the repo root and are written only by `npm run record`.

## Files

- `samples/index.json`: two sample entries, `tiny-roast` and `tiny-salad`.
- `samples/tiny-roast.md`, `samples/tiny-salad.md`: the recipe texts.
- `recordings/tiny-roast.json`, `recordings/tiny-salad.json`: the hand-made plans.

## Hand-worked facts

`tiny-roast` (suggested kitchen: 1 burner, 1 oven, 1 cook): five steps in two dishes,
`chicken` and `peas`. `validatePlan` gives exactly one issue, the warning
`appliance_mismatch` for `chicken.rest` with `word: 'roast'` and `suggested: 'oven'`: the
title "Rest the roast under foil" mentions "roast" but the step uses no appliance. "Roast
the chicken" and "Heat the oven" use the oven, so they do not fire. `checkKitchen` with the
suggested kitchen gives no issue.

`tiny-salad` (suggested kitchen: 0 burners, 0 ovens, 1 cook): three steps in one dish,
`salad`. `validatePlan` gives no issue (`salad.toss` is hands-on, so `short_hands_free`
does not fire). `checkKitchen` with the suggested kitchen gives no issue.

## How the hashes were made

`textSha256` is the lowercase hex SHA-256 of the UTF-8 bytes of the normalised file text:

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normaliseRecipeText } from './src/core/index.js';

const text = normaliseRecipeText(
  readFileSync('test/fixtures/not-a-recording/samples/tiny-roast.md', 'utf8'),
);
console.log(createHash('sha256').update(text, 'utf8').digest('hex'));
```

run with `npx tsx` from the repo root, once per text. The test
`test/server/parse/fixtures.test.ts` proves each hash.
