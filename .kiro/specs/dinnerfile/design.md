# Design: dinnerfile

Requirements: `requirements.md` in this folder. Rules this design follows without restating
them: `tech.md` (Result, error handling, TypeScript flags), `structure.md` (layout, import
rules, id patterns, naming), `testing.md` (test kinds, generators, oracles),
`scheduler-guarantees.md` (D1, D2), `product.md` ("The Dinnerfile", glossary), and the
recipe-graph spec (`canonicalPlan`, `compareIds`, `parsePlan`, `parseKitchen`,
`validatePlan`, `terminalSteps`, the generators and fixtures).

Facts about GNU Make below marked "(measured)" were checked in the spec session on the dev
machine's GNU Make 3.81 (`/usr/bin/make`, macOS) with scratch files outside the repo.

## Files

| file | holds |
| ---- | ----- |
| `src/core/dinnerfile.ts` | `toDinnerfile`, `fromDinnerfile`, `DinnerfileOptions`, `DinnerfileImport`, `DinnerfileError`, `DinnerfileErrorCode`, `MetadataKeyword` |
| `src/core/schema.ts` | adds `SERVE_TIME_PATTERN`, `ServeTimeSchema`, `ServeTime` |
| `src/core/index.ts` | re-exports the names above |
| `test/core/dinnerfile.test.ts` | export and import examples |
| `test/core/dinnerfile.pbt.ts` | D1, P-DF1 to P-DF6, P-DF8 to P-DF10 |
| `test/core/dinnerfile-make.test.ts` | examples that run GNU Make |
| `test/core/dinnerfile-make.pbt.ts` | D2, P-DF7 (they spawn `make`) |
| `test/support/arbitraries.ts` | extensions and new generators (below) |
| `test/support/oracles.ts` | new oracles (below) |
| `test/support/fixtures.ts` | `SUNDAY_ROAST_DINNERFILE`, `SUNDAY_ROAST_MAKE_DINNER`, `SUNDAY_ROAST_MAKE_GRAVY`, `WORST_CASE`, `WORST_CASE_DINNERFILE`, `WORST_CASE_MAKE_DINNER` |
| `test/support/make.ts` | `gnuMakeVersion`, `makeDir`, `runMake` (decided here) |
| `test/support/fc-params.ts` | adds `fcMakeParams()` |
| `test/meta/arbitraries.test.ts`, `test/meta/oracles.test.ts`, `test/meta/make.test.ts` | tests of the test support |

Import direction inside core: `dinnerfile.ts` → `sanity.ts` (`parsePlan`, `parseKitchen`),
`graph.ts` (`terminalSteps`), `schema.ts`, `result.ts`. Nothing in core imports
`dinnerfile.ts` except `index.ts`. No cycles.

## `src/core/schema.ts` additions

```ts
/** A 24-hour clock time from 00:00 to 23:59 (decided here). */
export const SERVE_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const ServeTimeSchema = z.string().regex(SERVE_TIME_PATTERN);
export type ServeTime = z.infer<typeof ServeTimeSchema>;
```

The plan screen will reuse `ServeTimeSchema` for its serving-time field; this spec only
carries the value through the file.

## `src/core/dinnerfile.ts`

```ts
export interface DinnerfileOptions {
  kitchen?: Kitchen;
  serve?: ServeTime;
}

export interface DinnerfileImport {
  /** Lexically checked only (R6.4); the caller runs validatePlan on it. Canonical order. */
  plan: Plan;
  /** Keys present only when their line is present. kitchen is lexically checked only;
   *  the caller runs parseKitchen on it. */
  options: DinnerfileOptions;
}

export type MetadataKeyword = 'plan' | 'dish' | 'step' | 'kitchen' | 'serve';
export type DinnerfileErrorCode = DinnerfileError['code'];
export type DinnerfileError = /* the union of one object type per row of the error table */;

/** The Dinnerfile text of a plan. err when the plan or the options fail their schemas. */
export function toDinnerfile(plan: Plan, options?: DinnerfileOptions): Result<string, Issue[]>;

/** Reads a Dinnerfile back. Never throws. */
export function fromDinnerfile(text: string): Result<DinnerfileImport, DinnerfileError[]>;
```

The scope asked for `Result<Plan, DinnerfileError[]>`. The value is `{ plan, options }`
instead, because the kitchen and serving time come back alongside the plan (decided here;
see open questions in the session reply).

`toDinnerfile` returns a `Result` because a plan that fails `PlanSchema` can hold step ids
with spaces or colons, and those cannot be written as single Make targets. The check uses
`parsePlan(plan)`, `parseKitchen(options.kitchen)` when present, and
`ServeTimeSchema.safeParse(options.serve)` when present, which on failure adds
`{ severity: 'error', code: 'invalid_field', field: 'serve', message: 'The serving time must
be a 24-hour time from 00:00 to 23:59, like 19:00.' }`. All issues go through `sortIssues`.
Only the keys `kitchen` and `serve` of `options` are read (decided here). Sanity errors
(cycles, unknown dependencies, and so on) do not stop export (R8.3).

## The file

### Lines

The text is split into lines as follows; line numbers are 1-based and count lines of the
input as given.

1. A U+FEFF at the very start is removed (import only).
2. Lines end at LF. A CR directly before an LF belongs to the line ending. The part after the
   last LF is a line too (empty when the text ends with LF, and then not counted as an extra
   line for errors).
3. White space at the end of each line (`String.prototype.trimEnd`) is removed before the
   line is read.

### Grammar

ABNF (RFC 5234) over the lines after step 3. `SP` is U+0020, `HTAB` U+0009, `WSP = SP / HTAB`.
The export writes the subset marked "export writes"; import accepts the full grammar.

```abnf
line            = blank / recipe-line / comment-line / rule-line
blank           = ""                                   ; after trimEnd
recipe-line     = HTAB *any                            ; content never read
comment-line    = *SP "#" *any                         ; metadata when it matches below
rule-line       = *SP target ":" *WSP [ names *WSP ] [ "#" *any ]
names           = name *( 1*WSP name )
target          = name                                 ; directly before ":", no WSP
name            = 1*( ALPHA / DIGIT / "-" / "." / "_" )

metadata-line   = *SP "#" *WSP ( plan-line / dish-line / step-line / kitchen-line / serve-line ) *WSP
plan-line       = "plan" 1*WSP string
dish-line       = "dish" 1*WSP dish-id 1*WSP string
step-line       = "step" *( 1*WSP field )
kitchen-line    = "kitchen" *( 1*WSP field )
serve-line      = "serve" 1*WSP time
field           = key "=" value
key             = 1*( ALPHA / DIGIT / "_" / "-" )
value           = string / 1*( %x21-7E / %x80-10FFFF )  ; a string, or a run without WSP

; values by key (step-line)
dish            = dish-id
minutes         = nat
appliance       = "burner" / "oven" / "none"
handsOn         = "true" / "false"
hold            = nat / "keeps"
title, detail   = string
; values by key (kitchen-line): burners, ovens, cooks = nat

nat             = "0" / ( %x31-39 0*5DIGIT )           ; no sign, no leading zero, <= 6 digits
time            = ( ( "0" / "1" ) DIGIT / "2" %x30-33 ) ":" %x30-35 DIGIT
dish-id         = 1*( %x61-7A / DIGIT ) *( "-" 1*( %x61-7A / DIGIT ) )   ; DISH_ID_PATTERN
step-id         = 1*( %x61-7A / DIGIT / "-" ) "." 1*( %x61-7A / DIGIT / "-" ) ; STEP_ID_PATTERN
string          = DQUOTE *( unescaped / escape ) DQUOTE   ; an RFC 8259 JSON string
unescaped       = %x20-21 / %x23-5B / %x5D-10FFFF          ; also lone surrogates, as UTF-16 units
escape          = "\" ( DQUOTE / "\" / "/" / "b" / "f" / "n" / "r" / "t" / "u" 4HEXDIG )
any             = %x00-10FFFF
```

Rules that ABNF does not say:

- A comment line is a metadata line when the first word after `#` and optional `WSP` is
  exactly one of `plan`, `dish`, `step`, `kitchen`, `serve` (case-sensitive), followed by
  `WSP` or the end of the line. `#step` is metadata; `# steps`, `# Step` and `#stepping` are
  unknown comments and are ignored (decided here).
- Step-line keys: `dish`, `minutes`, `appliance`, `handsOn`, `hold`, `title` required,
  `detail` optional. Kitchen-line keys: `burners`, `ovens`, `cooks`, all required. Any order,
  each at most once.
- A rule's target is classified: `.PHONY`; `dinner`; a dish target when it matches
  `DISH_ID_PATTERN`; a step target when it matches `STEP_ID_PATTERN`; otherwise
  `bad_target`. Prerequisites of step, dish and `dinner` rules must match `STEP_ID_PATTERN`
  (`bad_prerequisite` otherwise). `.PHONY` prerequisites are any `name` and are never read.
- No `WSP` between the target and `:`: GNU Make reads `export : x` as an `export` directive
  and `ifeq : x` as a broken conditional (measured), so a dish called `export` would mean
  different things to Make and to the importer. With the colon attached, `export: export.x`,
  `define: define.x`, `ifeq: ifeq.x`, `else: else.x` and the other directive words are plain
  rules (measured for ifeq, ifneq, ifdef, ifndef, else, endif, define, endef, override,
  export, unexport, include, sinclude, vpath, private, undefine, load).
- A line that ends in `\` (after trimEnd) is a `line_continuation` error, whatever its kind:
  Make joins it with the next line, and a comment ending in `\` swallows the next line
  (measured: a `# step ... \` line hid the rule below it). After the error is recorded the
  line is read without that final `\`, so one stray backslash gives one error.
- A recipe line before the first rule line is a `recipe_before_rule` error (GNU Make stops
  with "commands commence before first target", measured). After the first rule line, a line
  starting with `HTAB` is a recipe line and its content is never read, including text that
  looks like metadata (Make would hand it to the shell).
- A `# step` line is pending until the next rule line or the next `# step` line or the end.
  If that next thing is a step rule, the `# step` line attaches to it. Otherwise it is a
  `step_without_target` error. Blank lines, unknown comments and other metadata lines may
  stand between (R6.5).

### Layout written by `toDinnerfile`

`p` is `canonicalPlan` of the parsed plan. `terminal` is `terminalSteps(p)`.
`lastSteps(d)` is, sorted by id, every step `s` with `s.dish = d` such that no step `u` with
`u.dish = d` has `s.id` in `u.after` (R1.7). Every dish with steps in an acyclic plan has at
least one, and following same-dish successors from any of its steps ends at one, so
`make <dish>` reaches every step of the dish.

In order, each item one line, lines joined with LF, one LF at the end:

1. Header, four fixed lines (decided here):
   ```
   # Dinnerfile written by Make Dinner. GNU Make reads it:
   #   make -n -f Dinnerfile dinner    prints every step in an order that works
   #   make -n -f Dinnerfile <dish>    prints the steps one dish needs
   # The "# plan", "# dish", "# step", "# kitchen" and "# serve" lines hold the plan.
   ```
   None of their first words is a metadata keyword.
2. A blank line.
3. `# plan <enc(p.title)>`.
4. When `options.kitchen` is present: `# kitchen burners=<b> ovens=<o> cooks=<c>`.
5. When `options.serve` is present: `# serve <HH:MM>`.
6. For each dish of `p.dishes` in order: `# dish <id> <enc(name)>`.
7. A blank line.
8. `.PHONY:` then, each after one space: `dinner`, the distinct dish ids except `dinner` in
   id order, every step id in order.
9. `dinner:` then ` <id>` for each id of `terminal`.
10. A blank line.
11. For each distinct dish id `d` in id order: if `d` is `dinner`, the fixed line
    `# No target for dish dinner: "dinner" makes the whole plan.`; otherwise `d:` then
    ` <id>` for each id of `lastSteps(d)`.
12. For each step `s` of `p.steps` in order: a blank line, then
    - `# step dish=<s.dish> minutes=<s.minutes> appliance=<s.appliance> handsOn=<s.handsOn>
      hold=<s.holdMin ?? 'keeps'> title=<enc(s.title)>` and, when `detail` is present,
      ` detail=<enc(s.detail)>`, all on one line, keys in this order;
    - `<s.id>:` then ` <id>` for each entry of `s.after` (canonical: sorted, distinct);
    - HTAB, `@echo '`, `echoArg(s.title)`, `' # `, `s.id`.

Numbers are written with `String(n)` (integers from the schema, so `nat` form). Booleans as
`true`/`false`.

### Text in metadata: `enc(text)`

`enc` writes `"`, then each code point of `text` as below, then `"` (decided here). The
result is a JSON string that `JSON.parse` reads back to `text` unit for unit.

| code point | written as |
| ---------- | ---------- |
| `"` | `\"` |
| `\` | `\\` |
| U+0008, U+000C, LF, CR, HTAB | `\b`, `\f`, `\n`, `\r`, `\t` |
| other U+0000–U+001F, U+007F–U+009F | `\u00XX` (lowercase hex) |
| U+2028, U+2029 | `\u2028`, `\u2029` |
| bidirectional controls U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069 | `\uXXXX` (lowercase) |
| U+FEFF | `\ufeff` |
| a lone surrogate (U+D800–U+DFFF not part of a pair) | `\uXXXX` (lowercase) |
| anything else (`'`, `$`, `#`, `` ` ``, `:`, `=`, `%`, spaces, non-ASCII, emoji) | itself |

Why this is enough:

- A Make comment runs to the end of the line and nothing in it is expanded, so `$`, `#`,
  `'`, `` ` ``, `:`, `=` and `%` are harmless there. The only ways out of a comment are a line
  break and a final `\`. `enc` writes no LF or CR, and every line that holds text ends with
  the closing `"`, so no metadata line ends in `\` or in white space (R2.2, R2.3).
- Import strips white space at line ends and turns CRLF into LF; neither can reach inside a
  string, because no raw CR, LF or other control character is ever inside one, and the
  string ends with `"`.
- U+2028, U+2029, the bidirectional controls and U+FEFF are escaped so that an editor that
  breaks lines at them or reorders text around them shows the line as it is. Lone surrogates
  are escaped so the text is well-formed UTF-16 and can be saved as UTF-8.
- Import decodes with `JSON.parse` only after the token matched `string`, so `JSON.parse`
  cannot throw, and it accepts every JSON escape, including ones the export never writes
  (`\/`, `\u0041`). No Unicode normalisation is applied (R2.4).

### The echo line: `echoArg(title)`

1. **Display form** (R3.2): each code point of `title`: U+0000–U+001F, U+007F–U+009F, U+2028,
   U+2029 become one space; the bidirectional controls above, U+FEFF and lone surrogates
   become U+FFFD; others are kept. A title with a newline therefore shows on one line, and no
   escape sequence (U+001B) reaches the terminal.
2. **Shell and Make quoting** (R3.3), over the display form: `'` becomes `'\''`; `$` becomes
   `$$`, plus `''` directly after when the next code point is `(` or `{`; everything else is
   kept.

The line is HTAB `@echo '` + `echoArg(title)` + `' # ` + step id.

Why this is safe:

- **Make.** Make expands `$` in recipe lines before running them. Every `$` from the title is
  doubled, so Make expands nothing and passes one `$` on. GNU Make 3.81 runs a recipe line
  under `-n` when its text contains `$(MAKE)` or `${MAKE}`; `$$(MAKE)` contains that string
  and ran under `-n` (measured), while `$$''(MAKE)` did not (measured). Inserting `''`
  between `$$` and `(` or `{` means the line never contains `$(` or `${` (R3.4). Make has no
  other special character in a recipe line except a final `\` (never, the line ends with the
  step id) and a leading `@`, `-`, `+` (the line starts with the fixed `@echo`).
- **Shell.** The argument is one single-quoted shell word. Inside single quotes nothing is
  special except `'`, which `'\''` closes, escapes and reopens. Backticks, `$`, `;`, `#`,
  `"`, `\`, `|` and `&` are literal. The `# <step-id>` after the closing quote is a shell
  comment: step ids hold only `[a-z0-9.-]`.
- **What is printed.** Under `make -n`, Make prints the line after expansion and without the
  `@`: `echo '<argument with $$ as $>' # <step-id>` (measured). The shell word reads as the
  display form, which equals the title whenever the title has none of the replaced code
  points. Without `-n`, the shell runs `echo` only. What `echo` then prints for a title
  starting with `-n` or holding `\c` depends on the shell's `echo`; `make -n` output is the
  promised form (R3.5), `make` output is best effort.

The step id after the argument is there because titles need not be unique, and D2 must tell
which step each printed line is. The id is also useful to a person reading `make -n`
output. `product.md` writes the recipe line as `@echo '<title>'`; see conflict C3.

### Names and collisions

| name | can collide with | handling |
| ---- | ---------------- | -------- |
| step id | a dish id, `dinner` | impossible: step ids contain `.`, dish ids and `dinner` do not |
| step id, dish id | `.PHONY` or any Make special target | impossible: special targets start with `.`; ids start with `[a-z0-9-]` and are lowercase |
| dish id `dinner` | the `dinner` target | no rule for that dish; the fixed comment line instead (R4.2). `make dinner` is the whole plan; the dish's steps are in it |
| dish id that is a Make directive word (`export`, `define`, `include`, `ifeq`, `else`, ...) | the directive | no white space before `:` (measured above); in prerequisite lists the words are plain names |
| step id starting with `-` (`--.--` matches the pattern) | a command-line option | only on the command line, where nobody passes step ids; in the file `--.--:` is a plain rule (measured) |
| any id | a file in the working directory | every target is in `.PHONY`, so Make never checks files |
| dish id `makefile` or another default makefile name | Make's makefile remaking | Make remakes only the file it read (`Dinnerfile`, capital D); target names are compared as strings |

### Worst case

`WORST_CASE` (in `test/support/fixtures.ts`), as JavaScript:

```ts
export const WORST_CASE: Plan = {
  title: 'Worst "case" \\ #',
  dishes: [
    { id: 'export', name: 'Export  ' },
    { id: 'dinner', name: 'Dinner itself' },
    { id: 'define', name: 'D\u00e9finir' },
  ],
  steps: [
    {
      id: 'define.y', dish: 'define', title: 'Line\r\nbreak\u0000 and \u2028end',
      minutes: 480, appliance: 'oven', handsOn: false, after: ['export.x'], holdMin: 480,
    },
    {
      id: 'export.x', dish: 'export',
      title: " It's $(MAKE) ${HOME} $$ `touch canary` $(shell touch canary) ; touch canary #1 \\ 50% a:=b\tc\nd\u202ee\ud800 \\",
      detail: 'Line one\nLine two "quoted" \\c',
      minutes: 5, appliance: 'burner', handsOn: false, after: ['--.--'], holdMin: 0,
    },
    {
      id: '--.--', dish: 'dinner', title: '-n',
      minutes: 1, appliance: 'none', handsOn: true, after: [], holdMin: null,
    },
  ],
};
```

The `export.x` title (99 code points) has leading and trailing spaces, `'`, `$(MAKE)`,
`${HOME}`, `$$`, backticks, `$(shell ...)`, `;`, `#`, `\`, `%`, `:=`, a tab, a newline, a
right-to-left override (U+202E), a lone surrogate (U+D800) and a final `\`. It passes
`PlanSchema` and `checkPlan` gives no issue. `toDinnerfile(WORST_CASE)` is, after the four
header lines and a blank line (shown with a real tab before `@echo`; `�` is U+FFFD):

```make
# plan "Worst \"case\" \\ #"
# dish define "Définir"
# dish dinner "Dinner itself"
# dish export "Export  "

.PHONY: dinner define export --.-- define.y export.x
dinner: define.y

define: define.y
# No target for dish dinner: "dinner" makes the whole plan.
export: export.x

# step dish=dinner minutes=1 appliance=none handsOn=true hold=keeps title="-n"
--.--:
	@echo '-n' # --.--

# step dish=define minutes=480 appliance=oven handsOn=false hold=480 title="Line\r\nbreak\u0000 and \u2028end"
define.y: export.x
	@echo 'Line  break  and  end' # define.y

# step dish=export minutes=5 appliance=burner handsOn=false hold=0 title=" It's $(MAKE) ${HOME} $$ `touch canary` $(shell touch canary) ; touch canary #1 \\ 50% a:=b\tc\nd\u202ee\ud800 \\" detail="Line one\nLine two \"quoted\" \\c"
export.x: --.--
	@echo ' It'\''s $$''(MAKE) $$''{HOME} $$$$ `touch canary` $$''(shell touch canary) ; touch canary #1 \ 50% a:=b c d�e� \' # export.x
```

`make -n -f Dinnerfile dinner` in an empty directory prints (measured), exit 0, empty stderr:

```
echo '-n' # --.--
echo ' It'\''s $''(MAKE) $''{HOME} $$ `touch canary` $''(shell touch canary) ; touch canary #1 \ 50% a:=b c d�e� \' # export.x
echo 'Line  break  and  end' # define.y
```

`make -f Dinnerfile dinner` (no `-n`) exits 0 and creates no file named `canary` (measured).
`fromDinnerfile` of the text gives back `canonicalPlan(WORST_CASE)` exactly, lone surrogate,
tab, CR, NUL and trailing spaces included.

### Sunday roast

`SUNDAY_ROAST_DINNERFILE` is the complete text of `toDinnerfile(SUNDAY_ROAST)`, written by
hand in `test/support/fixtures.ts` as an array of lines joined with `'\n'` plus a final
`'\n'`, with the tab written as `\t` so it is visible in review. After the header and a blank
line:

```make
# plan "Sunday roast"
# dish chicken "Roast chicken"
# dish gravy "Gravy"
# dish greens "Spring greens"

.PHONY: dinner chicken gravy greens chicken.carve chicken.prep chicken.rest chicken.roast gravy.roux gravy.simmer gravy.strain greens.boil greens.shred greens.toss
dinner: chicken.carve gravy.strain greens.toss

chicken: chicken.carve
gravy: gravy.strain
greens: greens.toss

# step dish=chicken minutes=5 appliance=none handsOn=true hold=5 title="Carve the chicken"
chicken.carve: chicken.rest
	@echo 'Carve the chicken' # chicken.carve

# step dish=chicken minutes=10 appliance=none handsOn=true hold=keeps title="Season and truss the chicken"
chicken.prep:
	@echo 'Season and truss the chicken' # chicken.prep

# step dish=chicken minutes=20 appliance=none handsOn=false hold=30 title="Rest the chicken under foil"
chicken.rest: chicken.roast
	@echo 'Rest the chicken under foil' # chicken.rest

# step dish=chicken minutes=75 appliance=oven handsOn=false hold=5 title="Roast the chicken"
chicken.roast: chicken.prep
	@echo 'Roast the chicken' # chicken.roast

# step dish=gravy minutes=2 appliance=burner handsOn=true hold=5 title="Make a roux in the roasting tin" detail="Use the juices left in the tin once the chicken is out."
gravy.roux: chicken.roast
	@echo 'Make a roux in the roasting tin' # gravy.roux

# step dish=gravy minutes=10 appliance=burner handsOn=false hold=5 title="Add stock and let the gravy thicken"
gravy.simmer: gravy.roux
	@echo 'Add stock and let the gravy thicken' # gravy.simmer

# step dish=gravy minutes=2 appliance=none handsOn=true hold=15 title="Strain the gravy into a jug"
gravy.strain: gravy.simmer
	@echo 'Strain the gravy into a jug' # gravy.strain

# step dish=greens minutes=4 appliance=burner handsOn=false hold=0 title="Cook the greens in salted water"
greens.boil: greens.shred
	@echo 'Cook the greens in salted water' # greens.boil

# step dish=greens minutes=5 appliance=none handsOn=true hold=keeps title="Shred the greens"
greens.shred:
	@echo 'Shred the greens' # greens.shred

# step dish=greens minutes=1 appliance=none handsOn=true hold=5 title="Toss the greens with butter"
greens.toss: greens.boil
	@echo 'Toss the greens with butter' # greens.toss
```

Hand-worked: canonical step order puts `chicken.carve` before `chicken.prep` (`c` < `p`) and
`chicken.rest` before `chicken.roast` (`e` < `o`). Terminal steps: `chicken.carve`,
`gravy.strain`, `greens.toss`. Last steps per dish: the same three, one each.
`chicken.roast` is not a last step of `chicken` because `chicken.rest` (same dish) waits on
it; the edge `chicken.roast → gravy.roux` crosses dishes and does not count. With
`{ kitchen: HOME_KITCHEN, serve: '19:00' }` the only change is two lines after `# plan`:
`# kitchen burners=4 ovens=1 cooks=1` and `# serve 19:00`.

GNU Make visits prerequisites left to right, depth first, so `make -n -f Dinnerfile dinner`
prints (measured, matches the hand-worked order) `SUNDAY_ROAST_MAKE_DINNER`:

```
echo 'Season and truss the chicken' # chicken.prep
echo 'Roast the chicken' # chicken.roast
echo 'Rest the chicken under foil' # chicken.rest
echo 'Carve the chicken' # chicken.carve
echo 'Make a roux in the roasting tin' # gravy.roux
echo 'Add stock and let the gravy thicken' # gravy.simmer
echo 'Strain the gravy into a jug' # gravy.strain
echo 'Shred the greens' # greens.shred
echo 'Cook the greens in salted water' # greens.boil
echo 'Toss the greens with butter' # greens.toss
```

and `make -n -f Dinnerfile gravy` prints `SUNDAY_ROAST_MAKE_GRAVY`: chicken.prep,
chicken.roast, gravy.roux, gravy.simmer, gravy.strain (the gravy needs the roasting tin).
`make -n -f Dinnerfile` with no goal prints the same as `dinner` (R1.5).

## `fromDinnerfile`

One pass over the lines, then two checks. No recursion; every regular expression is a
single character class with a quantifier or a fixed word; the string scanner walks code
units once (N2).

1. **Read lines** (as in "Lines"). For each line, in order:
   - blank: skip.
   - ends in `\`: record `line_continuation`, drop the `\`, go on.
   - starts with HTAB: before the first rule, `recipe_before_rule`; after it, skip.
   - remove leading SP. Starts with `#`: if metadata (keyword rule), parse it with the
     field scanner below and record it (`# plan`, `# kitchen`, `# serve` a second time give
     `duplicate_metadata`); a `# step` line becomes pending, and a `# step` line already
     pending gets `step_without_target`. Other comments: skip.
   - otherwise match `rule-line`. No match: `unsupported_line` with `reason` (below).
     Match: classify the target; record `bad_target` or `bad_prerequisite`; a second rule
     for the same step id, dish id or `dinner` gives `duplicate_target` (with `firstLine`);
     a step rule takes the pending `# step` line or gets `target_without_step`; any other
     rule with a `# step` pending gives that line `step_without_target`. Mark "first rule
     seen".
   - At the end, a pending `# step` line gets `step_without_target`; no `# plan` line gives
     `missing_plan`.
2. **Field scanner** for `# step` and `# kitchen` lines: repeat: skip `WSP`; read `key` up to
   `=` (no `=`: `bad_metadata`); if the value starts with `"`, scan a JSON string (escape
   followed by one of `"\/bfnrtu`, `u` by 4 hex digits; any code unit below U+0020 or the end
   of the line before the closing `"` is `bad_value`); else read up to `WSP`. Then the key
   check: not in the keyword's key set: `unknown_key`; seen before: `duplicate_key`; value
   not of the key's form: `bad_value`. After the line: each missing required key gives
   `missing_key`. `# plan`, `# dish` and `# serve` lines are matched as a whole against
   their ABNF; a mismatch gives `bad_metadata`, except a malformed string or a bad dish id or
   time gives `bad_value` with `key` `title`, `name`, `dish` or `serve` (decided here).
3. **Errors so far**: if any, return `err` (R7.13).
4. **Build** `{ title, dishes, steps }`: dishes in file order of their `# dish` lines; one step
   per step rule, `after` = its prerequisites in order, the other fields from its `# step`
   line (`hold=keeps` → `holdMin: null`, `detail` absent when the key is absent). Return
   value plan = `canonicalPlan` of it.
5. **Mismatch checks** (R6.7, R7.9) on that plan: a dish rule whose target names no dish:
   `dish_target_mismatch`; a dish rule whose prerequisite set differs from `lastSteps(d)`:
   `dish_target_mismatch`; a `dinner` rule whose set differs from `terminalSteps(plan)`:
   `dinner_mismatch`. Any: `err`; none: `ok({ plan, options })`.

`stepId` is put on an error of a `# step` line when the line attached to a step rule, and on
errors of a step rule. Errors are deduplicated and sorted by `line` (`null` first), `code`,
`stepId ?? ''`, `key ?? ''` with `compareIds`.

`unsupported_line` reasons, checked in this order on a line that is not a rule:
`space_before_colon` (a `name`, then `WSP`, then `:`), `double_colon` (`::`),
`several_targets` (two or more names before `:`), `other`.

### Errors

Every error: `{ code, line, message, ...extra }`. Messages start with `Line <n>: ` (except
`missing_plan`), use only line numbers, ids that match their pattern, key names from the
grammar, numbers and fixed words (R7.11), and say what to change.

| code | line | extra fields | example message |
| ---- | ---- | ------------ | --------------- |
| `unsupported_line` | the line | `reason: 'space_before_colon' \| 'double_colon' \| 'several_targets' \| 'other'` | `Line 12: Make Dinner reads only comments, rules like "chicken.carve: chicken.rest" and recipe lines. Remove this line or rewrite it as one of those.` (`space_before_colon`: `Line 12: put the ":" directly after the target name.`; `several_targets`: `Line 12: a rule may have one target. Write one rule per step.`; `double_colon`: `Line 12: use one ":" between the target and its prerequisites.`) |
| `line_continuation` | the line | none | `Line 7: the line ends with "\", which makes Make join it to the next line. Remove the "\".` |
| `recipe_before_rule` | the line | none | `Line 3: this line starts with a tab before any rule, so Make stops here. Remove the tab.` |
| `bad_target` | the rule | none | `Line 20: the target is not a step id (like chicken.roast), a dish id, dinner or .PHONY. Rename it.` |
| `bad_prerequisite` | the rule | `stepId?`, `dishId?` (the rule's target when valid) | `Line 20: step chicken.carve lists a prerequisite that is not a step id (like chicken.rest). Only steps can be prerequisites.` |
| `missing_plan` | `null` | none | `The file has no "# plan" line. Add one near the top, like: # plan "Sunday roast"` |
| `duplicate_metadata` | the later line | `keyword: 'plan' \| 'kitchen' \| 'serve'`, `firstLine` | `Line 9: a second "# kitchen" line (the first is line 7). Keep one.` |
| `bad_metadata` | the line | `keyword` | `Line 8: a "# dish" line must look like: # dish gravy "Gravy"` |
| `unknown_key` | the line | `keyword: 'step' \| 'kitchen'`, `stepId?` | `Line 14: the "# step" line has a key this app does not use. The keys are dish, minutes, appliance, handsOn, hold, title and detail.` |
| `duplicate_key` | the line | `keyword`, `key`, `stepId?` | `Line 14: the "# step" line gives minutes twice. Keep one.` |
| `missing_key` | the line | `keyword`, `key`, `stepId?` | `Line 14: the "# step" line has no hold. Add hold=<minutes> or hold=keeps.` |
| `bad_value` | the line | `keyword`, `key`, `stepId?` | `Line 14: minutes must be a whole number with no sign or leading zero, like minutes=15.` (one fixed sentence per key, decided here) |
| `step_without_target` | the `# step` line | none | `Line 30: this "# step" line is not followed by a step rule. Put it directly above the rule of its step, or remove it.` |
| `target_without_step` | the rule | `stepId` | `Line 31: step greens.toss has no "# step" line above it. Add one, like: # step dish=greens minutes=1 appliance=none handsOn=true hold=keeps title="Toss the greens"` |
| `duplicate_target` | the later rule | `target` (a valid id or `dinner`), `firstLine`, `stepId?`, `dishId?` | `Line 40: greens.toss is the target of a second rule (the first is line 31). Make would merge their prerequisites; keep one rule.` |
| `dish_target_mismatch` | the rule | `dishId` | `Line 18: the rule for dish gravy must list the dish's last steps: gravy.strain. Fix it or remove the rule.` or `Line 18: there is no "# dish sauce" line for the rule sauce. Add the dish or remove the rule.` |
| `dinner_mismatch` | the rule | none | `Line 12: dinner must list the plan's terminal steps: chicken.carve gravy.strain greens.toss. Fix it or remove the rule.` |

`DinnerfileError` is the TypeScript union of these rows (`code` a string literal per row,
`line: number` except `missing_plan` with `line: null`). Ids put in errors always match their
pattern, because only names that matched are kept as ids.

## `src/core/index.ts`

Adds `toDinnerfile`, `fromDinnerfile`, `SERVE_TIME_PATTERN`, `ServeTimeSchema`, and the types
`ServeTime`, `DinnerfileOptions`, `DinnerfileImport`, `DinnerfileError`,
`DinnerfileErrorCode`, `MetadataKeyword`.

## Test support

### Generator extensions (`test/support/arbitraries.ts`)

Extensions only; nothing is narrowed (`testing.md`). They change what every existing
property sees, which is the point: free text and ids everywhere get harder.

- `arbNonBlank(max)` gains a branch, weight 2 of 11, drawing `arbHostileText(max)`.
- `arbDishId` gains a branch, weight 1 of 6, from `dinner`, `define`, `export`, `include`,
  `ifeq`, `else`, `endif`, `override`, `vpath`, `makefile`. `fc.uniqueArray` keeps ids
  unique.
- `arbSlug` gains a branch, weight 1 of 6, from slugs with a leading or trailing `-` or only
  dashes (`-x`, `x-`, `--`, `-0-`).

New, with signatures:

```ts
export function arbHostileText(max: number): fc.Arbitrary<string>;
export function arbServeTime(): fc.Arbitrary<string>;
export function arbDinnerfileOptions(): fc.Arbitrary<DinnerfileOptions>;
export function arbAnyDinnerfileOptions(): fc.Arbitrary<DinnerfileOptions>;
export function arbDinnerfileStyle(plan: Plan): fc.Arbitrary<DinnerfileStyle>;
export function arbDinnerfileLikeText(): fc.Arbitrary<string>;
export interface BreakingCase { text: string; code: DinnerfileErrorCode; line: number | null }
export function arbBreakingEdit(plan: Plan): fc.Arbitrary<BreakingCase>;
```

- **arbHostileText(max)**: 1 to 12 tokens joined, kept when it has a non-white-space
  character and at most `max` code points. Tokens (the hostile alphabet, decided here):
  `'`, `"`, `$`, `$$`, `$(MAKE)`, `${MAKE}`, `$(shell touch canary)`, `` `touch canary` ``,
  `'\''`, `; touch canary`, `#`, `# step dish=x`, `\`, `\c`, LF, CR, CRLF, HTAB,
  `\t@touch canary`, `:`, `=`, `:=`, `%`, `|`, `*`, `-n`, `-e`, one and two spaces,
  U+0000, U+001B `[31m`, U+007F, U+0085, U+00A0, U+2028, U+2029, U+202E, U+2066, U+FEFF,
  `é`, `e` + U+0301, `🔥`, U+D800 alone, U+DFFF alone, `漢字`, `word`.
- **arbServeTime**: hour 0..23 and minute 0..59, zero-padded.
- **arbDinnerfileOptions**: `kitchen` from `arbKitchen()` and `serve` from `arbServeTime()`,
  each key present or absent (absent, never `undefined`).
- **arbAnyDinnerfileOptions**: like the above, but each present value is, half the time, a
  value that fails its schema (kitchen counts -1, 9, 1.5, a string; serve `24:00`, `7:00`,
  `19:60`, `19:00\n.PHONY: x`, `''`, `fc.string()`). Typed by cast in the generator only.
- **arbDinnerfileStyle(plan)** draws a `DinnerfileStyle` (type in `oracles.ts`) for
  `oracleDinnerfile`: every way of writing the same plan that R6.6 accepts: `eol` LF or
  CRLF; `bom`; `header` on or off; `phony` one line, none, or one `.PHONY: <name>` line
  before each rule's block; `dinnerRule` and `dishRules` on or off; `recipes` echo, none, or
  other text (`\t@true`, `\techo "$@" ; exit 1`); white space added at line ends; extra blank
  lines between lines; unknown comments inserted between lines (`#`, `# note`,
  `#   Plan "x"`, `# steps below`, `# plan2`, `#stepping`); spaces before comment and rule
  lines; ` # note` after rule lines; a permutation of step keys and of kitchen keys; runs of
  SP and HTAB as field and prerequisite separators, and none after `:`; step blocks, dish
  lines and the option lines in a permuted order, metadata at the top or the bottom;
  `\uXXXX` escapes for every non-ASCII code point and `\/` for `/` in strings; one
  prerequisite repeated. Per-rule `.PHONY` lines go before a block's `# step` line, never
  between it and its rule (a `.PHONY` rule there would end the pending `# step`). Every
  other insertion is a blank line or a comment, which R6.5 allows anywhere.
- **arbDinnerfileLikeText**: one of `fc.string({ unit: 'binary' })`; 0 to 40 lines from a
  vocabulary of valid and broken metadata, rule and recipe lines (bad keys, bad numbers,
  unterminated strings, `$`, `%`, `::`, `X = 1`, `include x`, lines ending in `\`, tab
  lines) joined by LF, CRLF or CR; or an `oracleDinnerfile` text with 1 to 3 random
  character insertions, deletions or line swaps.
- **arbBreakingEdit(plan)**: the canonical `oracleDinnerfile(plan, {})` text with exactly one
  meaning-changing edit, and the one error import must report (code and line, computed on
  the edited text):

  | edit | code | line |
  | ---- | ---- | ---- |
  | remove one `# step` line | `target_without_step` | its rule |
  | remove one step rule line | `step_without_target` | its `# step` line |
  | append a copy of one step rule with one more prerequisite after its recipe | `duplicate_target` | the copy |
  | add ` extra=1` to one `# step` line | `unknown_key` | that line |
  | replace `minutes=<n>` with one of `minutes=1.5`, `-3`, `007`, `` (empty), `abc`, `1e3`, `1234567` | `bad_value` | that line |
  | replace `handsOn=<b>` with `yes`; `hold=<v>` with `keep` | `bad_value` | that line |
  | remove `minutes=<n>` | `missing_key` | that line |
  | repeat the `# plan` line after the dish lines | `duplicate_metadata` | the repeat |
  | remove the `# plan` line | `missing_plan` | `null` |
  | add a step id that is not a last step to a dish rule (dish with two or more steps) | `dish_target_mismatch` | that rule |
  | add a non-terminal step id to the `dinner` rule (plan with a non-terminal step) | `dinner_mismatch` | that rule |
  | append ` \` to one line | `line_continuation` | that line |
  | insert `X = 1`, `include other`, `a.x : b.y` or `a.x b.y:` at a block boundary | `unsupported_line` | the inserted line |
  | insert `\t@true` before the `.PHONY` line | `recipe_before_rule` | the inserted line |

  Edits that need a shape the plan lacks are not drawn for it.

### Oracles (`test/support/oracles.ts`)

Plain loops, written from this design without looking at `src/core/dinnerfile.ts`; imports
from `src/core` only types and schemas.

```ts
export interface DinnerfileStyle { /* the fields listed under arbDinnerfileStyle */ }
export const CANONICAL_STYLE: DinnerfileStyle;   // the layout toDinnerfile writes
export function oracleEncodeText(text: string): string;
export function oracleEchoText(title: string): string;
export function oracleDinnerfile(plan: Plan, options: DinnerfileOptions, style?: DinnerfileStyle): string;
export type MakeLineKind = 'blank' | 'comment' | 'rule' | 'recipe' | 'other';
export function oracleMakeLines(text: string): MakeLineKind[];
export function decodeEchoLine(line: string, stage: 'file' | 'printed'): { text: string; stepId: string } | null;
export function oracleDishLastSteps(plan: Plan): Record<string, string[]>;
export function oracleNeededSteps(plan: Plan, dishId: string): string[];
```

- `oracleEncodeText`: a `switch` per code point following the `enc` table.
- `oracleEchoText`: the display form, code point by code point.
- `oracleDinnerfile`: writes the layout from its own sort (plain comparison of strings by
  `<`), its own terminal and last-step loops, `oracleEncodeText` and its own `echoArg`, in the
  given style. With `CANONICAL_STYLE` it is the full expected export.
- `oracleMakeLines`: splits on LF and classifies each line by the forms export may write, and
  nothing looser: `blank` is `''`; `comment` starts with `#` and contains no code point below
  U+0020 or in U+007F–U+009F; `rule` is `.PHONY:` or a dish id or `dinner` or step id, then
  `:`, then zero or more ` <name>` with names of `[a-z0-9.-]`; `recipe` is HTAB `@echo '`,
  then tokens (`'\''`; `$$''` followed by `(` or `{`; `$$` followed by neither; any code point
  other than `'`, `$`, below U+0020 or in U+007F–U+009F), then `' # `, then a step id;
  everything else `other`.
- `decodeEchoLine`: for `stage: 'file'` strips HTAB `@` and turns `$$` into `$`; then matches
  `echo '`, decodes single-quoted shell words (text up to the next `'`, then either `\''`
  continues, or `''` continues, or `' # <step-id>` and the end finishes), returning `null`
  for anything else.
- `oracleDishLastSteps`, `oracleNeededSteps`: by definition, over all pairs of steps; the
  second is a fixed-point loop adding prerequisites until nothing changes.

### Fixtures (`test/support/fixtures.ts`)

`SUNDAY_ROAST_DINNERFILE`, `SUNDAY_ROAST_MAKE_DINNER` (array of the 10 printed lines),
`SUNDAY_ROAST_MAKE_GRAVY` (5 lines), `WORST_CASE`, `WORST_CASE_DINNERFILE` (the complete
export, by hand, header included) and `WORST_CASE_MAKE_DINNER` (3 lines), exactly as above,
each with a comment giving where it was worked out.

### Make runner (`test/support/make.ts`)

```ts
export interface MakeRun { status: number | null; stdout: string; stderr: string }
/** First line of `make --version`. Throws when make is missing or the line does not start
 *  with "GNU Make", with a message saying D2 needs GNU Make on PATH. */
export function gnuMakeVersion(path?: string): string;
/** A fresh directory under os.tmpdir(); callers remove it in afterAll. */
export function makeDir(): string;
/** Writes dir/Dinnerfile and runs `make -f Dinnerfile ...args` there with env { PATH } only. */
export function runMake(dir: string, text: string, args: readonly string[]): MakeRun;
```

`runMake` uses `spawnSync` with `encoding: 'utf8'`, `timeout: 10_000` and the file written as
UTF-8. A spawn error (ENOENT when `make` is missing) is thrown, so a test fails rather than
skips (R9.3). Only `PATH` is passed, so `MAKEFLAGS`, `MAKEFILES` or `SHELL` in the developer's
environment cannot change the result.

### Run count for `make` (`test/support/fc-params.ts`)

```ts
/** For properties that spawn make: FC_MAKE_RUNS when it is a positive integer, else 50. */
export function fcMakeParams(): Parameters<unknown[]>;
```

Measured: 200 runs of `make -n` on a 34-target file took 2.27 s, about 11 ms per spawn. At
50 runs, D2 and P-DF7 together add about 1.5 s with file writes, inside the after-write
hook's 25 s budget. `FC_NUM_RUNS` does not change this count. See conflict C1.

## Correctness properties

Run counts: `fcParams()` (200 by default, `FC_NUM_RUNS`) for `test/core/dinnerfile.pbt.ts`,
`fcMakeParams()` (50 by default, `FC_MAKE_RUNS`) for `test/core/dinnerfile-make.pbt.ts`.
Titles start with the id. "Valid" generators: `arbPlan()` and `arbPlan({ large: true })`.
"Graph-rule cases": `arbBrokenPlan(rule)` for `unknown_dependency`, `self_dependency`,
`cycle`, `unknown_dish`, `dish_without_steps`, `duplicate_dish_id`, turned into a `Plan` with
`PlanSchema.parse` as in the recipe-graph design.

| id | statement | validates | generator |
| -- | --------- | --------- | --------- |
| D1 round trip | `toDinnerfile(p)` is `ok`; `fromDinnerfile` of its text is `ok` and strictly deep-equals `{ plan: canonicalPlan(p), options: {} }`; `validatePlan` of the imported plan gives no error | R1.1, R2.1–R2.4, R6.3, R8.1 | valid generators |
| D2 make agrees | `runMake(dir, text, ['-n', 'dinner'])` exits 0 with empty stderr; every stdout line passes `decodeEchoLine(line, 'printed')`; the step ids are every step id exactly once; the order passes `respectsPrecedence`; each text equals `oracleEchoText(title)` | R3.5, R9.1, N3 | `arbPlan()`, `arbPlan({ large: true })` (and the fixtures as examples) |
| P-DF1 total | `fromDinnerfile` never throws on any string; returns `ok` or `err` with >= 1 error; every error's `line` is `null` only for `missing_plan` and else within the line count; errors sorted and duplicate-free; every message is non-empty printable ASCII; on `ok`, the plan equals its own `canonicalPlan` | R6.1, R7.10–R7.12, N2 | `arbDinnerfileLikeText()`, `fc.string({ unit: 'binary' })` |
| P-DF2 Make lines | every line of `toDinnerfile(p, o)` has a kind other than `other` in `oracleMakeLines`; the text ends with exactly one LF and has no CR; no line ends in `\` or white space; the text is well-formed UTF-16; the first rule after `.PHONY` is `dinner`; no recipe line contains `$(` or `${` | R1.4, R1.5, R2.2, R2.3, R3.4, R4.1, R4.3, R5.3 | valid generators with `arbDinnerfileOptions()` |
| P-DF3 options | `fromDinnerfile(toDinnerfile(p, o))` is `ok` with `options` strictly deep-equal to `o` and `plan` to `canonicalPlan(p)`; removing the `# kitchen` and `# serve` lines from `toDinnerfile(p, o)` gives `toDinnerfile(p)`; with `arbAnyDinnerfileOptions`, `toDinnerfile` is `err` exactly when `kitchen` fails `KitchenSchema` or `serve` fails `ServeTimeSchema`, and never throws | R1.2, R5.1–R5.4, R8.2 | `arbPlan()`, `arbDinnerfileOptions()`, `arbAnyDinnerfileOptions()` |
| P-DF4 tolerant | for any style, `fromDinnerfile(oracleDinnerfile(p, o, style))` equals `fromDinnerfile(toDinnerfile(p, o))` | R6.5, R6.6, R6.7 | `arbPlan()`, `arbDinnerfileOptions()`, `arbDinnerfileStyle(p)` |
| P-DF5 breaking | `fromDinnerfile(case.text)` is `err` with exactly one error, of `case.code` at `case.line` | R6.4, R7.1–R7.9, R7.13 | `arbBreakingEdit(p)` over `arbPlan()` |
| P-DF6 echo | for each step, its recipe line in the export passes `decodeEchoLine(line, 'file')` with that step's id and `oracleEchoText(title)` | R3.1–R3.3, R3.7 | valid generators |
| P-DF7 dish target | for one dish `d` (not `dinner`) drawn from the plan, `runMake(dir, text, ['-n', d])` exits 0 with empty stderr and prints `oracleNeededSteps(p, d)`, each once, in an order passing `respectsPrecedence` | R1.7, R4.2, R9.2 | `arbPlan()` with a drawn dish index |
| P-DF8 faults survive | for graph-rule cases, `fromDinnerfile(toDinnerfile(p))` is `ok` with `canonicalPlan(p)`, and `validatePlan` on it gives the issues `checkPlan(p)` gives; for `duplicate_step_id` cases, `err` whose codes are only `duplicate_target` | R8.3 | graph-rule cases, `arbBrokenPlan('duplicate_step_id')` |
| P-DF9 order-free | `toDinnerfile(shuffled)` equals `toDinnerfile(p)` | R1.3 | `arbPlan()`, `arbShuffledPlan` |
| P-DF10 layout | `toDinnerfile(p, o)` equals `oracleDinnerfile(p, o)` (canonical style), so every line of the layout is checked for every generated plan | R1.1, R1.6–R1.9, R2.1, R3.1–R3.3, R4.2, R5.2 | valid generators with `arbDinnerfileOptions()` |

D1 and D2 are the ids of `scheduler-guarantees.md`; `test/meta/guarantees.test.ts` (scheduler
spec) gets the claim `dinnerfile: ['D']`, which needs at least one property titled `D1 ...`
and one `D2 ...`.

## Example tests (outline)

- `test/core/dinnerfile.test.ts`:
  - export: `toDinnerfile(SUNDAY_ROAST)` is `ok(SUNDAY_ROAST_DINNERFILE)`, compared as
    strings, character for character (R1.1); with `{ kitchen: HOME_KITCHEN, serve: '19:00' }`
    the two extra lines at lines 7 and 8; `toDinnerfile(WORST_CASE)` is
    `ok(WORST_CASE_DINNERFILE)`; a hand-shuffled `SUNDAY_ROAST` gives the same text; a dish
    with no steps gives `greens:`; a dish `dinner` gives the fixed comment and no rule; a plan
    with a cycle exports; `toDinnerfile` on a plan with a step id `a b` returns the exact
    `invalid_field` issue of `parsePlan`; `serve: '24:00'` returns the exact serve issue;
    `kitchen.cooks: 0` returns the exact `parseKitchen` issue.
  - import, accepted: `fromDinnerfile(SUNDAY_ROAST_DINNERFILE)` is
    `ok({ plan: canonicalPlan(SUNDAY_ROAST), options: {} })`; the same file by hand with CRLF,
    a BOM, trailing spaces, no header, no `.PHONY`, no echo lines, no dish rules, no `dinner`
    rule, keys reordered, `a.x:b.y` without a space, a rule with ` # note`, `\u0041` and `\/`
    in strings, blocks reversed, `# Step` and `# steps` comments: each the same result;
    with `# kitchen` and `# serve`: the options; `WORST_CASE_DINNERFILE`: the canonical worst
    case, `\ud800` and all.
  - import, errors: for each code one firing example asserting the exact error list (every
    field, message included) and one non-firing neighbour (`#step` is metadata while
    `#stepping` is not; `minutes=0` is lexically fine and left to `validatePlan`, which gives
    `minutes_out_of_range`; `minutes=007` is `bad_value`; `ifeq: ifeq.x` with no space is a
    dish rule while `ifeq : ifeq.x` is `unsupported_line` `space_before_colon`; a `.PHONY`
    naming an unknown target is fine; a tab line after a rule is ignored even when it reads
    `\t# step dish=x`); several errors come back in line order; a `# step` line with a bad
    value gives no extra `target_without_step`; a file with a bad line gives no mismatch
    error (R7.13); `''` gives exactly `missing_plan`.
- `test/core/dinnerfile-make.test.ts`: `gnuMakeVersion()` starts with `GNU Make`;
  `gnuMakeVersion('')` (empty `PATH`) throws (R9.3); `make -n dinner` on
  `SUNDAY_ROAST_DINNERFILE` prints exactly `SUNDAY_ROAST_MAKE_DINNER`; `make -n gravy`
  exactly `SUNDAY_ROAST_MAKE_GRAVY`; `make -n` with no goal equals the `dinner` output;
  `make -n dinner` on `WORST_CASE_DINNERFILE` prints exactly `WORST_CASE_MAKE_DINNER`;
  `make dinner` without `-n` on it exits 0 and the directory then holds only `Dinnerfile`
  (no `canary`) (R3.6); `make -n` on each of `MEZZE` and `TIGHT_OVEN` exports passes the D2
  checks.
- `test/meta/oracles.test.ts`: `oracleDinnerfile(SUNDAY_ROAST, {})` equals
  `SUNDAY_ROAST_DINNERFILE` and `oracleDinnerfile(WORST_CASE, {})` equals
  `WORST_CASE_DINNERFILE` (both hand-written); `oracleEchoText` and `oracleEncodeText` on
  the worst-case title give the strings shown above; `oracleMakeLines` gives `other` for
  `export : x`, `X = 1`, `\t@echo '$$(MAKE)' # a.b` (contains `$(`) and a comment ending in
  `\`; `decodeEchoLine` decodes the three worst-case printed lines; `oracleNeededSteps`
  gives the five gravy steps; `oracleDishLastSteps(WORST_CASE)` gives
  `{ define: ['define.y'], dinner: ['--.--'], export: ['export.x'] }`.
- `test/meta/arbitraries.test.ts`: from `fc.sample` with a fixed seed: every extended
  `arbPlan` value still passes the recipe-graph validity checks; the samples together hold
  every hostile token, a `dinner` dish and a directive-word dish, a slug with a leading `-`;
  `arbServeTime` matches `SERVE_TIME_PATTERN`; `arbAnyDinnerfileOptions` yields both valid
  and invalid values; every `arbBreakingEdit` case's line is `null` or within the text and
  every row of its table occurs; `arbDinnerfileStyle` samples cover every style field.
- `test/meta/make.test.ts`: `runMake` on a two-rule text in `makeDir()` returns the printed
  line and status 0; the directory is removed in `afterAll`.

## Conflicts found

**C1. Run count for `make` properties.** `testing.md` says "`numRuns: 200` per property by
default, overridable with `FC_NUM_RUNS`; never lowered in code to make a run pass". The scope
of this spec asks for "a small run count stated in the design" for properties that spawn
`make`. This design sets 50 through `fcMakeParams()` for D2 and P-DF7 only, for cost (about
11 ms per spawn, measured), not to make a run pass; every other property of this spec uses
`fcParams()`. It also does I/O (temporary files, a child process) in two properties, where
`testing.md` asks for pure properties. Needs the user's confirmation; an alternative is 200
runs with a 30 s test timeout. This spec does not edit the steering file.

**C2. Metadata fields beyond `product.md`.** `product.md` gives
`# step dish=<id> minutes=<n> appliance=<a> handsOn=<bool> hold=<n|keeps>`,
`# dish <id> <name>` and `# plan <title>`. Import must read data only from comments, so the
step title and detail must be in a comment too: this design adds `title=` and `detail=` to
the `# step` line, after the five listed keys. Names and titles are written as JSON strings
(`# dish chicken "Roast chicken"`, `# plan "Sunday roast"`), because a bare name cannot keep
trailing spaces or a newline. `product.md` is silent on both, so these extend rather than
contradict it; the steering line could be updated to show them.

**C3. The echo line.** `product.md` says "The recipe line is `@echo '<title>'`". This design
writes `@echo '<display form, quoted>' # <step-id>`: the argument is the display form with
`'`, `$` quoted (R3.2, R3.3), and a shell comment with the step id follows, because titles
need not be unique and D2 must tell the printed lines apart. Without the id, D2 could only
check plans with distinct titles, which narrows the generator. Needs the user's
confirmation.

**C4. Docker has no `make`.** `node:22-slim` does not ship GNU Make, so D2 and P-DF7 fail
there by design (R9.3). Tests do not run in Docker today; CI needs GNU Make on `PATH`.

## Review notes (by hand, 2026-11-11)

- C1 accepted: D2 and P-DF7 run 50 times by default (`FC_MAKE_RUNS`), because each run spawns
  `make`. `testing.md`'s 200 applies to in-process properties.
- C2 and C3 accepted; `product.md` now describes this format.
- C4: Docker does not run the tests, so `make` is not needed in the image.
- Open question 1: no line mapping for `validatePlan` issues. 2: keep `@echo`. 3: import
  reports at most 50 errors, then one line saying how many more there are.
