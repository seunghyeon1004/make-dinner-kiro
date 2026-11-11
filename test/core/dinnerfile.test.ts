import { describe, expect, it } from 'vitest';
import { fromDinnerfile, toDinnerfile } from '../../src/core/dinnerfile.js';
import type { DinnerfileError } from '../../src/core/dinnerfile.js';
import { err, ok } from '../../src/core/result.js';
import { parseKitchen, validatePlan } from '../../src/core/sanity.js';
import { canonicalPlan } from '../../src/core/schema.js';
import type { Plan, Step } from '../../src/core/schema.js';
import {
  DINNERFILE_HEADER,
  HOME_KITCHEN,
  SUNDAY_ROAST,
  SUNDAY_ROAST_DINNERFILE,
  WORST_CASE,
  WORST_CASE_DINNERFILE,
} from '../support/fixtures.js';

// Dinnerfile spec, T2.1: export. Expected texts are written out by hand from the design.

const step = (id: string, over: Partial<Step> = {}): Step => ({
  id,
  dish: id.split('.')[0] ?? '',
  title: id,
  minutes: 1,
  appliance: 'none',
  handsOn: true,
  after: [],
  holdMin: null,
  ...over,
});

/** The expected text: the four header lines, a blank line, then `body`, one LF at the end. */
const withHeader = (body: readonly string[]): string =>
  [...DINNERFILE_HEADER, '', ...body].join('\n') + '\n';

describe('R1.1 toDinnerfile on the hand-worked plans', () => {
  it('SUNDAY_ROAST is SUNDAY_ROAST_DINNERFILE, character for character', () => {
    expect(toDinnerfile(SUNDAY_ROAST)).toEqual(ok(SUNDAY_ROAST_DINNERFILE));
  });
  it('WORST_CASE is WORST_CASE_DINNERFILE, character for character', () => {
    expect(toDinnerfile(WORST_CASE)).toEqual(ok(WORST_CASE_DINNERFILE));
  });
  it('options {} and no options are the same', () => {
    expect(toDinnerfile(SUNDAY_ROAST, {})).toEqual(toDinnerfile(SUNDAY_ROAST));
  });
});

describe('R5.2 the kitchen and serve lines', () => {
  const lines = (text: string): string[] => text.split('\n');
  const plain = lines(SUNDAY_ROAST_DINNERFILE);

  it('a kitchen and a serving time are lines 7 and 8, directly after the # plan line', () => {
    const result = toDinnerfile(SUNDAY_ROAST, { kitchen: HOME_KITCHEN, serve: '19:00' });
    expect(result.ok).toBe(true);
    const out = lines(result.ok ? result.value : '');
    expect(out[5]).toBe('# plan "Sunday roast"');
    expect(out[6]).toBe('# kitchen burners=4 ovens=1 cooks=1');
    expect(out[7]).toBe('# serve 19:00');
    expect([...out.slice(0, 6), ...out.slice(8)]).toEqual(plain);
  });
  it('a kitchen alone is line 7, a serving time alone is line 7', () => {
    const kitchen = toDinnerfile(SUNDAY_ROAST, { kitchen: { burners: 0, ovens: 4, cooks: 6 } });
    const serve = toDinnerfile(SUNDAY_ROAST, { serve: '00:00' });
    expect(kitchen.ok && lines(kitchen.value)[6]).toBe('# kitchen burners=0 ovens=4 cooks=6');
    expect(serve.ok && lines(serve.value)[6]).toBe('# serve 00:00');
    expect(kitchen.ok && lines(kitchen.value).length).toBe(plain.length + 1);
    expect(serve.ok && lines(serve.value).length).toBe(plain.length + 1);
  });
  it('R5.3: without the two lines the text is the text without options', () => {
    const result = toDinnerfile(SUNDAY_ROAST, { kitchen: HOME_KITCHEN, serve: '19:00' });
    const stripped = lines(result.ok ? result.value : '')
      .filter((l) => !l.startsWith('# kitchen ') && !l.startsWith('# serve '))
      .join('\n');
    expect(stripped).toBe(SUNDAY_ROAST_DINNERFILE);
  });
  it('only the keys kitchen and serve of the options are read', () => {
    const options = { serve: '19:00', note: 'x', kitchen: undefined } as unknown as Parameters<
      typeof toDinnerfile
    >[1];
    const result = toDinnerfile(SUNDAY_ROAST, options);
    expect(result.ok && lines(result.value).filter((l) => l.startsWith('# '))[5]).toBe(
      '# serve 19:00',
    );
    expect(result.ok && result.value.includes('note')).toBe(false);
  });
});

describe('R1.3 order does not matter', () => {
  it('a hand-shuffled SUNDAY_ROAST (steps and dishes reversed) gives the same text', () => {
    const shuffled: Plan = {
      ...SUNDAY_ROAST,
      dishes: [...SUNDAY_ROAST.dishes].reverse(),
      steps: [...SUNDAY_ROAST.steps].reverse(),
    };
    expect(toDinnerfile(shuffled)).toEqual(ok(SUNDAY_ROAST_DINNERFILE));
  });
  it('after lists are written sorted, once each: a.z waits on a.x a.y however it was listed', () => {
    const plan: Plan = {
      title: 'Order',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [
        step('a.z', { after: ['a.y', 'a.x', 'a.y'], title: 'Z' }),
        step('a.y', { title: 'Y' }),
        step('a.x', { title: 'X' }),
      ],
    };
    const result = toDinnerfile(plan);
    expect(result).toEqual(
      ok(
        withHeader([
          '# plan "Order"',
          '# dish a "A"',
          '',
          '.PHONY: dinner a a.x a.y a.z',
          'dinner: a.z',
          '',
          'a: a.z',
          '',
          '# step dish=a minutes=1 appliance=none handsOn=true hold=keeps title="X"',
          'a.x:',
          "\t@echo 'X' # a.x",
          '',
          '# step dish=a minutes=1 appliance=none handsOn=true hold=keeps title="Y"',
          'a.y:',
          "\t@echo 'Y' # a.y",
          '',
          '# step dish=a minutes=1 appliance=none handsOn=true hold=keeps title="Z"',
          'a.z: a.x a.y',
          "\t@echo 'Z' # a.z",
        ]),
      ),
    );
  });
});

describe('R1.7, R4.2 dish rules', () => {
  it('a dish with no steps gets the rule "roast:" with no prerequisites, and is in .PHONY', () => {
    const plan: Plan = {
      title: 'Two dishes',
      dishes: [
        { id: 'roast', name: 'Roast' },
        { id: 'greens', name: 'Greens' },
      ],
      steps: [
        step('roast.cook', {
          title: 'Roast it',
          minutes: 30,
          appliance: 'oven',
          holdMin: 10,
          handsOn: false,
        }),
      ],
    };
    expect(toDinnerfile(plan)).toEqual(
      ok(
        withHeader([
          '# plan "Two dishes"',
          '# dish greens "Greens"',
          '# dish roast "Roast"',
          '',
          '.PHONY: dinner greens roast roast.cook',
          'dinner: roast.cook',
          '',
          'greens:',
          'roast: roast.cook',
          '',
          '# step dish=roast minutes=30 appliance=oven handsOn=false hold=10 title="Roast it"',
          'roast.cook:',
          "\t@echo 'Roast it' # roast.cook",
        ]),
      ),
    );
  });
  it('a dish called dinner gets the fixed comment line and no rule; dinner stays the whole plan', () => {
    const plan: Plan = {
      title: 'Dinner dish',
      dishes: [{ id: 'dinner', name: 'Dinner' }],
      steps: [step('dinner.serve', { title: 'Serve' })],
    };
    expect(toDinnerfile(plan)).toEqual(
      ok(
        withHeader([
          '# plan "Dinner dish"',
          '# dish dinner "Dinner"',
          '',
          '.PHONY: dinner dinner.serve',
          'dinner: dinner.serve',
          '',
          '# No target for dish dinner: "dinner" makes the whole plan.',
          '',
          '# step dish=dinner minutes=1 appliance=none handsOn=true hold=keeps title="Serve"',
          'dinner.serve:',
          "\t@echo 'Serve' # dinner.serve",
        ]),
      ),
    );
  });
  it('a dish rule lists only the last steps of the dish: chicken.roast is not one', () => {
    const text = toDinnerfile(SUNDAY_ROAST);
    const lines = (text.ok ? text.value : '').split('\n');
    expect(lines).toContain('chicken: chicken.carve');
    expect(lines).not.toContain('chicken: chicken.carve chicken.roast');
    expect(lines.filter((l) => /^(chicken|gravy|greens):/.test(l)).length).toBe(3);
  });
  it('a dish with two last steps lists both, sorted, and steps of other dishes do not count', () => {
    const plan: Plan = {
      title: 'Two ends',
      dishes: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      steps: [
        step('a.one', { title: 'One' }),
        step('a.two', { title: 'Two', after: ['a.one'] }),
        step('a.three', { title: 'Three', after: ['a.one'] }),
        // b.use waits on a.three from another dish; a.three is still a last step of a.
        step('b.use', { title: 'Use', after: ['a.three'] }),
      ],
    };
    const result = toDinnerfile(plan);
    const lines = (result.ok ? result.value : '').split('\n');
    expect(lines).toContain('a: a.three a.two');
    expect(lines).toContain('b: b.use');
    expect(lines).toContain('dinner: a.two b.use');
  });
});

describe('R1.2 plans the export accepts although the sanity rules would not', () => {
  it('a plan with a cycle exports: dinner has no prerequisites and the dish rule is empty', () => {
    const plan: Plan = {
      title: 'Cycle',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [
        step('a.x', { title: 'X', after: ['a.y'] }),
        step('a.y', { title: 'Y', after: ['a.x'] }),
      ],
    };
    expect(toDinnerfile(plan)).toEqual(
      ok(
        withHeader([
          '# plan "Cycle"',
          '# dish a "A"',
          '',
          '.PHONY: dinner a a.x a.y',
          'dinner:',
          '',
          'a:',
          '',
          '# step dish=a minutes=1 appliance=none handsOn=true hold=keeps title="X"',
          'a.x: a.y',
          "\t@echo 'X' # a.x",
          '',
          '# step dish=a minutes=1 appliance=none handsOn=true hold=keeps title="Y"',
          'a.y: a.x',
          "\t@echo 'Y' # a.y",
        ]),
      ),
    );
  });
  it('an unknown prerequisite is written as it is', () => {
    const plan: Plan = {
      title: 'Unknown',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [step('a.x', { title: 'X', after: ['a.missing'] })],
    };
    const result = toDinnerfile(plan);
    expect(result.ok && result.value.split('\n')).toContain('a.x: a.missing');
  });
});

describe('R1.2 plans and options that fail their schemas', () => {
  it('a step id with a space gives exactly the issue parsePlan gives, and no text', () => {
    const bad = {
      ...SUNDAY_ROAST,
      steps: SUNDAY_ROAST.steps.map((s) => (s.id === 'greens.toss' ? { ...s, id: 'a b' } : s)),
    };
    expect(toDinnerfile(bad)).toEqual(
      err([
        {
          severity: 'error',
          code: 'invalid_field',
          field: 'steps[0].id',
          message:
            'Step 1: the id must look like chicken.roast: lowercase letters, digits and hyphens around one dot, up to 80 characters.',
        },
      ]),
    );
  });
  it("serve '24:00' gives exactly the serve issue", () => {
    expect(toDinnerfile(SUNDAY_ROAST, { serve: '24:00' })).toEqual(
      err([
        {
          severity: 'error',
          code: 'invalid_field',
          field: 'serve',
          message: 'The serving time must be a 24-hour time from 00:00 to 23:59, like 19:00.',
        },
      ]),
    );
  });
  it('kitchen.cooks 0 gives exactly the issue parseKitchen gives', () => {
    expect(toDinnerfile(SUNDAY_ROAST, { kitchen: { burners: 4, ovens: 1, cooks: 0 } })).toEqual(
      err([
        {
          severity: 'error',
          code: 'invalid_field',
          field: 'cooks',
          message: 'The kitchen: cooks must be a whole number from 1 to 6.',
        },
      ]),
    );
  });
  it('a bad plan, kitchen and serving time together give all three, in sortIssues order', () => {
    const bad = { ...SUNDAY_ROAST, title: '' };
    const result = toDinnerfile(bad, {
      kitchen: { burners: 4, ovens: 1, cooks: 0 },
      serve: '7:00',
    });
    expect(result.ok).toBe(false);
    const fields = result.ok ? [] : result.error.map((i) => i.code === 'invalid_field' && i.field);
    // sortIssues: errors first, then by code, then by the extra fields (here `field`, in order).
    expect(fields).toEqual(['cooks', 'serve', 'title']);
  });
  it.each([null, undefined, 42, 'text', [], {}])(
    '%j as a plan is err with issues, never a throw',
    (value) => {
      const result = toDinnerfile(value as unknown as Plan);
      expect(result.ok).toBe(false);
      expect(result.ok ? 0 : result.error.length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------------------
// T3.1: import, accepted files. The variants are the hand-written ones of the design outline,
// each made from SUNDAY_ROAST_DINNERFILE by a change written out in the test.

const SUNDAY_RESULT = ok({ plan: canonicalPlan(SUNDAY_ROAST), options: {} });

/** The blank-line separated sections of SUNDAY_ROAST_DINNERFILE: header, plan lines, .PHONY and
 *  dinner, dish rules, then the ten step blocks. */
const sections = SUNDAY_ROAST_DINNERFILE.trimEnd().split('\n\n');
const baseLines = SUNDAY_ROAST_DINNERFILE.split('\n');

describe('R6.3 fromDinnerfile reads the exports back', () => {
  it('SUNDAY_ROAST_DINNERFILE gives the canonical plan and no options', () => {
    expect(fromDinnerfile(SUNDAY_ROAST_DINNERFILE)).toStrictEqual(SUNDAY_RESULT);
  });
  it('the result is not shared with the text: the plan has the ten steps and three dishes', () => {
    const result = fromDinnerfile(SUNDAY_ROAST_DINNERFILE);
    expect(result.ok && result.value.plan.steps.length).toBe(10);
    expect(result.ok && result.value.plan.dishes.map((d) => d.id)).toEqual([
      'chicken',
      'gravy',
      'greens',
    ]);
  });
  it('R2.4 WORST_CASE_DINNERFILE gives canonicalPlan(WORST_CASE) with every hostile character back', () => {
    const result = fromDinnerfile(WORST_CASE_DINNERFILE);
    expect(result).toStrictEqual(ok({ plan: canonicalPlan(WORST_CASE), options: {} }));
    const titles = result.ok ? result.value.plan.steps.map((s) => s.title) : [];
    const exportX = titles[2] ?? '';
    expect(sections.length).toBe(14);
    expect(exportX.includes('\ud800 \\')).toBe(true);
    expect(exportX.includes('\t')).toBe(true);
    expect(exportX.includes('\n')).toBe(true);
    expect(exportX.startsWith(' It')).toBe(true);
    expect(titles[1]).toBe('Line\r\nbreak\u0000 and \u2028end');
    const dishes = result.ok ? result.value.plan.dishes.map((d) => d.name) : [];
    expect(dishes).toEqual(['D\u00e9finir', 'Dinner itself', 'Export  ']);
    const detail = result.ok ? result.value.plan.steps[2]?.detail : undefined;
    expect(detail).toBe('Line one\nLine two "quoted" \\c');
  });
});

describe('R6.6 changes of form that do not change the result', () => {
  const variants: [string, string][] = [
    ['CRLF line endings', SUNDAY_ROAST_DINNERFILE.replaceAll('\n', '\r\n')],
    ['a leading BOM', `\ufeff${SUNDAY_ROAST_DINNERFILE}`],
    ['BOM and CRLF', `\ufeff${SUNDAY_ROAST_DINNERFILE.replaceAll('\n', '\r\n')}`],
    [
      'spaces and tabs at the end of every line',
      baseLines.map((l, i) => l + (i % 2 === 0 ? '   ' : '\t ')).join('\n'),
    ],
    ['no header comments', baseLines.slice(5).join('\n')],
    ['no .PHONY rule', baseLines.filter((l) => !l.startsWith('.PHONY:')).join('\n')],
    [
      'a repeated .PHONY rule',
      baseLines.flatMap((l) => (l.startsWith('.PHONY:') ? [l, l] : [l])).join('\n'),
    ],
    ['no recipe lines', baseLines.filter((l) => !l.startsWith('\t')).join('\n')],
    [
      'recipe lines with other content',
      baseLines.map((l) => (l.startsWith('\t') ? '\t@true' : l)).join('\n'),
    ],
    ['no dish rules', baseLines.filter((l) => !/^(chicken|gravy|greens): /.test(l)).join('\n')],
    ['no dinner rule', baseLines.filter((l) => !l.startsWith('dinner:')).join('\n')],
    [
      'no space after the colon',
      baseLines.map((l) => l.replace(/^(chicken\.rest): /, '$1:')).join('\n'),
    ],
    [
      'a comment at the end of rule lines',
      baseLines.map((l) => (/^[a-z.]+:( |$)/.test(l) ? `${l} # a note` : l)).join('\n'),
    ],
    [
      'spaces before comment and rule lines',
      baseLines.map((l) => (l.startsWith('#') || /^[a-z.]+:/.test(l) ? `   ${l}` : l)).join('\n'),
    ],
    ['blank lines everywhere', baseLines.flatMap((l) => [l, '', '   ']).join('\n')],
    [
      'unknown comments: # Step, # steps and #stepping',
      baseLines
        .flatMap((l) => [l, '# Step dish=x', '# steps below', '#stepping', '# plan2'])
        .join('\n'),
    ],
    [
      'the step blocks in reverse order',
      [...sections.slice(0, 4), ...sections.slice(4).reverse()].join('\n\n') + '\n',
    ],
    [
      'the plan and dish lines at the bottom',
      [sections[0], ...sections.slice(2), sections[1]].join('\n\n') + '\n',
    ],
    [
      'the dish lines in reverse order',
      baseLines.map((l, i) => (i >= 6 && i <= 8 ? (baseLines[14 - i] ?? l) : l)).join('\n'),
    ],
    [
      'a repeated prerequisite',
      baseLines
        .map((l) =>
          l.replace(/^(chicken\.rest): chicken\.roast$/, '$1: chicken.roast chicken.roast'),
        )
        .join('\n'),
    ],
    [
      '\\u0053 for S in the plan title',
      baseLines
        .map((l) => l.replace('# plan "Sunday roast"', '# plan "\\u0053unday roast"'))
        .join('\n'),
    ],
    [
      'the keys of one step line in another order',
      baseLines
        .map((l) =>
          l.startsWith('# step dish=greens minutes=5')
            ? '# step title="Shred the greens" hold=keeps handsOn=true appliance=none minutes=5 dish=greens'
            : l,
        )
        .join('\n'),
    ],
    [
      'tabs between the fields of a step line',
      baseLines
        .map((l) => {
          if (!l.startsWith('# step dish=greens minutes=1')) return l;
          const at = l.indexOf(' title=');
          return `${l.slice(0, at).replaceAll(' ', '\t')}\t${l.slice(at + 1)}`;
        })
        .join('\n'),
    ],
  ];

  it.each(variants)('%s gives the same result', (_name, text) => {
    expect(fromDinnerfile(text)).toStrictEqual(SUNDAY_RESULT);
  });

  it('\\/ in a string is /', () => {
    const text = baseLines
      .map((l) => (l.startsWith('# plan ') ? '# plan "Sunday \\/ roast"' : l))
      .join('\n');
    const result = fromDinnerfile(text);
    expect(result.ok && result.value.plan.title).toBe('Sunday / roast');
  });
});

describe('R5.4 # kitchen and # serve', () => {
  const withOptions = (...extra: string[]): string =>
    [...baseLines.slice(0, 6), ...extra, ...baseLines.slice(6)].join('\n');

  it('both lines give both options', () => {
    expect(
      fromDinnerfile(withOptions('# kitchen burners=4 ovens=1 cooks=1', '# serve 19:00')),
    ).toStrictEqual(
      ok({
        plan: canonicalPlan(SUNDAY_ROAST),
        options: { kitchen: { burners: 4, ovens: 1, cooks: 1 }, serve: '19:00' },
      }),
    );
  });
  it('a kitchen alone leaves serve absent; a serving time alone leaves kitchen absent', () => {
    const kitchen = fromDinnerfile(withOptions('# kitchen cooks=2 burners=0 ovens=4'));
    const serve = fromDinnerfile(withOptions('# serve 09:05'));
    expect(kitchen.ok && kitchen.value.options).toStrictEqual({
      kitchen: { burners: 0, ovens: 4, cooks: 2 },
    });
    expect(serve.ok && serve.value.options).toStrictEqual({ serve: '09:05' });
  });
  it('the options come back as the export wrote them', () => {
    const options = { kitchen: HOME_KITCHEN, serve: '19:00' };
    const text = toDinnerfile(SUNDAY_ROAST, options);
    expect(fromDinnerfile(text.ok ? text.value : '')).toStrictEqual(
      ok({ plan: canonicalPlan(SUNDAY_ROAST), options }),
    );
  });
});

describe("R6.4 only the lexical form is checked; ranges are validatePlan's", () => {
  it('minutes=0 imports, and validatePlan then reports minutes_out_of_range for that step', () => {
    const text = baseLines
      .map((l) =>
        l.startsWith('# step dish=chicken minutes=5 ') ? l.replace('minutes=5', 'minutes=0') : l,
      )
      .join('\n');
    const result = fromDinnerfile(text);
    expect(result.ok).toBe(true);
    const checked = validatePlan(result.ok ? result.value.plan : null);
    expect(checked.plan).toBeNull();
    expect(checked.issues.map((i) => i.code)).toEqual(['minutes_out_of_range']);
  });
  it('a kitchen of nine ovens imports; parseKitchen is what rejects it', () => {
    const text = [
      ...baseLines.slice(0, 6),
      '# kitchen burners=4 ovens=9 cooks=1',
      ...baseLines.slice(6),
    ].join('\n');
    const result = fromDinnerfile(text);
    expect(result.ok && result.value.options.kitchen).toEqual({ burners: 4, ovens: 9, cooks: 1 });
    expect(parseKitchen(result.ok ? result.value.options.kitchen : null).ok).toBe(false);
  });
  it('a six-digit number is lexically fine', () => {
    const text = baseLines
      .map((l) =>
        l.startsWith('# step dish=chicken minutes=5 ')
          ? l.replace('minutes=5', 'minutes=999999')
          : l,
      )
      .join('\n');
    const result = fromDinnerfile(text);
    expect(result.ok && result.value.plan.steps[0]?.minutes).toBe(999999);
  });
});

describe('R8.3 plans with sanity errors still round-trip', () => {
  it('a plan with a cycle comes back as it was, and validatePlan reports the cycle', () => {
    const plan: Plan = {
      title: 'Cycle',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [
        step('a.x', { title: 'X', after: ['a.y'] }),
        step('a.y', { title: 'Y', after: ['a.x'] }),
      ],
    };
    const text = toDinnerfile(plan);
    const back = fromDinnerfile(text.ok ? text.value : '');
    expect(back).toStrictEqual(ok({ plan: canonicalPlan(plan), options: {} }));
    expect(validatePlan(back.ok ? back.value.plan : null).issues.map((i) => i.code)).toEqual([
      'cycle',
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// T3.2: import errors. One firing example per code with the exact error list, and the
// non-firing neighbours. Small files, so that line numbers are easy to read.

const STEP_X = '# step dish=a minutes=5 appliance=none handsOn=true hold=keeps title="X"';
const file = (...lines: string[]): string => `${lines.join('\n')}\n`;
/** A good one-step file; `extra` lines go after the rule, so they start at line 5. */
const small = (...extra: string[]): string =>
  file('# plan "T"', '# dish a "A"', STEP_X, 'a.x:', ...extra);

const errorsOf = (text: string): DinnerfileError[] => {
  const result = fromDinnerfile(text);
  return result.ok ? [] : result.error;
};
const codesOf = (text: string): string[] => errorsOf(text).map((e) => e.code);

const OTHER_MESSAGE =
  'Make Dinner reads only comments, rules like "chicken.carve: chicken.rest" and recipe lines. Remove this line or rewrite it as one of those.';

describe('R7 the good small file imports', () => {
  it('small() is a plan T with dish a and step a.x', () => {
    const result = fromDinnerfile(small());
    expect(result.ok && result.value.plan.steps.map((s) => s.id)).toEqual(['a.x']);
    expect(result.ok && result.value.plan.title).toBe('T');
  });
});

describe('R7.1 unsupported_line', () => {
  it('a variable: reason other', () => {
    expect(errorsOf(small('X = 1'))).toEqual([
      { code: 'unsupported_line', line: 5, reason: 'other', message: `Line 5: ${OTHER_MESSAGE}` },
    ]);
  });
  it.each([
    ['include other', 'a directive'],
    ['ifeq (a,b)', 'a conditional'],
    ['$(X): y', 'a variable target'],
    ['%.o: %.c', 'a pattern rule'],
    ['a.x: $(Y)', 'a variable prerequisite'],
    ['a.x: b.y; echo hi', 'a command after a semicolon'],
    ['a.x: b.y | c.z', 'an order-only prerequisite'],
    ['*.x: b.y', 'a wildcard target'],
    [':', 'a lone colon'],
    [': a.x', 'no target'],
  ])('%s (%s): reason other', (line) => {
    expect(errorsOf(small(line)).map((e) => [e.code, e.line, 'reason' in e && e.reason])).toEqual([
      ['unsupported_line', 5, 'other'],
    ]);
  });
  it('white space before the colon: reason space_before_colon', () => {
    expect(errorsOf(small('a.x : b.y'))).toEqual([
      {
        code: 'unsupported_line',
        line: 5,
        reason: 'space_before_colon',
        message: 'Line 5: put the ":" directly after the target name.',
      },
    ]);
  });
  it('two targets: reason several_targets', () => {
    expect(errorsOf(small('a.x b.y:'))).toEqual([
      {
        code: 'unsupported_line',
        line: 5,
        reason: 'several_targets',
        message: 'Line 5: a rule may have one target. Write one rule per step.',
      },
    ]);
  });
  it('a double colon: reason double_colon', () => {
    expect(errorsOf(small('a.x:: b.y'))).toEqual([
      {
        code: 'unsupported_line',
        line: 5,
        reason: 'double_colon',
        message: 'Line 5: use one ":" between the target and its prerequisites.',
      },
    ]);
  });
  it('non-firing: ifeq: ifeq.x with the colon attached is a rule, ifeq : ifeq.x is not', () => {
    const base = (rule: string): string =>
      file(
        '# plan "T"',
        '# dish ifeq "I"',
        '# step dish=ifeq minutes=1 appliance=none handsOn=true hold=keeps title="I"',
        'ifeq.x:',
        rule,
      );
    expect(codesOf(base('ifeq: ifeq.x'))).toEqual([]);
    expect(codesOf(base('ifeq : ifeq.x'))).toEqual(['unsupported_line']);
  });
  it('non-firing: a comment, a blank line, a recipe line and a # note after a rule', () => {
    expect(codesOf(small('# any comment', '', '\t@echo hi', '.PHONY: a.x # note'))).toEqual([]);
  });
});

describe('R7.2 line_continuation', () => {
  it('a comment ending in a backslash: one error, the line is read without it', () => {
    expect(errorsOf(file('# plan "T" \\', '# dish a "A"', STEP_X, 'a.x:'))).toEqual([
      {
        code: 'line_continuation',
        line: 1,
        message:
          'Line 1: the line ends with "\\", which makes Make join it to the next line. Remove the "\\".',
      },
    ]);
  });
  it('white space after the backslash does not hide it; a blank line with one is an error too', () => {
    expect(codesOf(small('# note \\  \t'))).toEqual(['line_continuation']);
    expect(codesOf(small(' \\'))).toEqual(['line_continuation']);
  });
  it('a backslash inside a line, not at its end, is fine', () => {
    expect(codesOf(small('# a \\ b'))).toEqual([]);
  });
  it('a recipe line ending in a backslash is an error as well', () => {
    expect(codesOf(small('\t@echo hi \\'))).toEqual(['line_continuation']);
  });
});

describe('R7.3 recipe_before_rule', () => {
  it('a tab line before the first rule', () => {
    expect(errorsOf(file('# plan "T"', '\t@true', '# dish a "A"', STEP_X, 'a.x:'))).toEqual([
      {
        code: 'recipe_before_rule',
        line: 2,
        message:
          'Line 2: this line starts with a tab before any rule, so Make stops here. Remove the tab.',
      },
    ]);
  });
  it('non-firing: after the first rule a tab line is a recipe, even one that looks like metadata', () => {
    expect(codesOf(small('\t# step dish=x', '\t# plan "Y"', '\t@true'))).toEqual([]);
  });
  it('non-firing: a line of only a tab is blank', () => {
    expect(codesOf(file('\t', '# plan "T"', '# dish a "A"', STEP_X, 'a.x:'))).toEqual([]);
  });
});

describe('R7.4 bad_target and bad_prerequisite', () => {
  it('a target that is no id: bad_target', () => {
    expect(errorsOf(small('Foo: a.x'))).toEqual([
      {
        code: 'bad_target',
        line: 5,
        message:
          'Line 5: the target is not a step id (like chicken.roast), a dish id, dinner or .PHONY. Rename it.',
      },
    ]);
  });
  it.each(['a_b: a.x', 'a.b.c: a.x', '.hidden: a.x', 'a--b.c.d:'])('%s is a bad target', (rule) => {
    expect(codesOf(small(rule))).toEqual(['bad_target']);
  });
  it('a prerequisite that is no step id: bad_prerequisite, with the step id', () => {
    expect(errorsOf(file('# plan "T"', '# dish a "A"', STEP_X, 'a.x: B'))).toEqual([
      {
        code: 'bad_prerequisite',
        line: 4,
        stepId: 'a.x',
        message:
          'Line 4: step a.x lists a prerequisite that is not a step id (like chicken.rest). Only steps can be prerequisites.',
      },
    ]);
  });
  it('a dish id as a prerequisite is bad too, and a dish rule reports its dish id', () => {
    expect(errorsOf(small('a: a.x a'))).toEqual([
      {
        code: 'bad_prerequisite',
        line: 5,
        dishId: 'a',
        message:
          'Line 5: dish a lists a prerequisite that is not a step id (like chicken.rest). Only steps can be prerequisites.',
      },
    ]);
  });
  it('the dinner rule reports it without an id', () => {
    expect(errorsOf(small('dinner: a.x nope'))).toEqual([
      {
        code: 'bad_prerequisite',
        line: 5,
        message:
          'Line 5: dinner lists a prerequisite that is not a step id (like chicken.rest). Only steps can be prerequisites.',
      },
    ]);
  });
  it('non-firing: .PHONY may name anything', () => {
    expect(codesOf(small('.PHONY: dinner nowhere Odd_Name'))).toEqual([]);
  });
});

describe('R7.5 missing_plan and duplicate_metadata', () => {
  it("'' gives exactly missing_plan, with line null", () => {
    expect(errorsOf('')).toEqual([
      {
        code: 'missing_plan',
        line: null,
        message: 'The file has no "# plan" line. Add one near the top, like: # plan "Sunday roast"',
      },
    ]);
  });
  it('a file with steps but no # plan line: missing_plan comes first', () => {
    expect(codesOf(file('# dish a "A"', STEP_X, 'a.x:'))).toEqual(['missing_plan']);
  });
  it('a second # plan line', () => {
    expect(errorsOf(file('# plan "T"', '# plan "U"', '# dish a "A"', STEP_X, 'a.x:'))).toEqual([
      {
        code: 'duplicate_metadata',
        line: 2,
        keyword: 'plan',
        firstLine: 1,
        message: 'Line 2: a second "# plan" line (the first is line 1). Keep one.',
      },
    ]);
  });
  it('a second # kitchen line and a second # serve line, each reported at its own line', () => {
    expect(
      errorsOf(
        small(
          '# kitchen burners=1 ovens=1 cooks=1',
          '# kitchen burners=2 ovens=1 cooks=1',
          '# serve 19:00',
          '# serve 20:00',
        ),
      ),
    ).toEqual([
      {
        code: 'duplicate_metadata',
        line: 6,
        keyword: 'kitchen',
        firstLine: 5,
        message: 'Line 6: a second "# kitchen" line (the first is line 5). Keep one.',
      },
      {
        code: 'duplicate_metadata',
        line: 8,
        keyword: 'serve',
        firstLine: 7,
        message: 'Line 8: a second "# serve" line (the first is line 7). Keep one.',
      },
    ]);
  });
  it('non-firing: several # dish lines are fine', () => {
    expect(codesOf(small('# dish b "B"'))).toEqual([]);
  });
});

describe('R7.6 metadata lines', () => {
  it.each([
    ['# plan', 'plan', 'a "# plan" line must look like: # plan "Sunday roast"'],
    ['# plan "T" extra', 'plan', 'a "# plan" line must look like: # plan "Sunday roast"'],
    ['# dish a', 'dish', 'a "# dish" line must look like: # dish gravy "Gravy"'],
    ['# dish', 'dish', 'a "# dish" line must look like: # dish gravy "Gravy"'],
    ['# dish a "A" extra', 'dish', 'a "# dish" line must look like: # dish gravy "Gravy"'],
    ['# serve', 'serve', 'a "# serve" line must look like: # serve 19:00'],
    ['# serve 19:00 20:00', 'serve', 'a "# serve" line must look like: # serve 19:00'],
    [
      '# step dish',
      'step',
      'a "# step" line must be a list of key=value fields, like: # step dish=gravy minutes=2 appliance=none handsOn=true hold=keeps title="Strain the gravy"',
    ],
    [
      '# kitchen 4',
      'kitchen',
      'a "# kitchen" line must be a list of key=value fields, like: # kitchen burners=4 ovens=1 cooks=1',
    ],
  ])('%s is bad_metadata (%s)', (line, keyword, shape) => {
    const text = line.startsWith('# plan')
      ? file(line, '# dish a "A"', STEP_X, 'a.x:')
      : line.startsWith('# step')
        ? file('# plan "T"', '# dish a "A"', line, 'a.x:')
        : small(line);
    const errors = errorsOf(text);
    const at = line.startsWith('# plan') ? 1 : line.startsWith('# step') ? 3 : 5;
    expect(errors).toEqual([
      { code: 'bad_metadata', line: at, keyword, message: `Line ${at}: ${shape}` },
    ]);
  });
  it('an unknown key in a # step line: unknown_key with the step id', () => {
    expect(errorsOf(file('# plan "T"', '# dish a "A"', `${STEP_X} extra=1`, 'a.x:'))).toEqual([
      {
        code: 'unknown_key',
        line: 3,
        keyword: 'step',
        stepId: 'a.x',
        message:
          'Line 3: the "# step" line has a key this app does not use. The keys are dish, minutes, appliance, handsOn, hold, title and detail.',
      },
    ]);
  });
  it('an unknown key in a # kitchen line names the kitchen keys', () => {
    expect(errorsOf(small('# kitchen burners=1 ovens=1 cooks=1 sinks=2'))).toEqual([
      {
        code: 'unknown_key',
        line: 5,
        keyword: 'kitchen',
        message:
          'Line 5: the "# kitchen" line has a key this app does not use. The keys are burners, ovens and cooks.',
      },
    ]);
  });
  it('a key twice: duplicate_key, naming the key', () => {
    expect(errorsOf(file('# plan "T"', '# dish a "A"', `${STEP_X} minutes=6`, 'a.x:'))).toEqual([
      {
        code: 'duplicate_key',
        line: 3,
        keyword: 'step',
        key: 'minutes',
        stepId: 'a.x',
        message: 'Line 3: the "# step" line gives minutes twice. Keep one.',
      },
    ]);
  });
  it('a required key missing: missing_key, naming the key', () => {
    const noHold = STEP_X.replace(' hold=keeps', '');
    expect(errorsOf(file('# plan "T"', '# dish a "A"', noHold, 'a.x:'))).toEqual([
      {
        code: 'missing_key',
        line: 3,
        keyword: 'step',
        key: 'hold',
        stepId: 'a.x',
        message: 'Line 3: the "# step" line has no hold. Add hold=<minutes> or hold=keeps.',
      },
    ]);
  });
  it('a kitchen key missing', () => {
    expect(errorsOf(small('# kitchen burners=1 ovens=1'))).toEqual([
      {
        code: 'missing_key',
        line: 5,
        keyword: 'kitchen',
        key: 'cooks',
        message: 'Line 5: the "# kitchen" line has no cooks. Add cooks=<number>.',
      },
    ]);
  });
  it('non-firing: detail is optional, and the keys may come in any order', () => {
    expect(
      codesOf(
        file(
          '# plan "T"',
          '# dish a "A"',
          '# step title="X" detail="More" hold=3 handsOn=false appliance=oven minutes=5 dish=a',
          'a.x:',
        ),
      ),
    ).toEqual([]);
  });

  describe('bad_value, one fixed sentence per key', () => {
    const stepWith = (from: string, to: string): string =>
      file('# plan "T"', '# dish a "A"', STEP_X.replace(from, to), 'a.x:');
    it.each([
      [
        'minutes=5',
        'minutes=1.5',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes=-3',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes=007',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes=',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes=abc',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes=1e3',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes=1234567',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'minutes=5',
        'minutes="5"',
        'minutes',
        'minutes must be a whole number with no sign or leading zero, like minutes=15.',
      ],
      [
        'hold=keeps',
        'hold=keep',
        'hold',
        'hold must be a whole number with no sign or leading zero, or keeps, like hold=5.',
      ],
      [
        'hold=keeps',
        'hold=-1',
        'hold',
        'hold must be a whole number with no sign or leading zero, or keeps, like hold=5.',
      ],
      ['appliance=none', 'appliance=stove', 'appliance', 'appliance must be burner, oven or none.'],
      ['handsOn=true', 'handsOn=yes', 'handsOn', 'handsOn must be true or false.'],
      ['handsOn=true', 'handsOn=True', 'handsOn', 'handsOn must be true or false.'],
      [
        'dish=a',
        'dish=A',
        'dish',
        'dish must be a dish id like chicken: lowercase letters and digits, with single hyphens between them.',
      ],
      [
        'dish=a',
        'dish=a--b',
        'dish',
        'dish must be a dish id like chicken: lowercase letters and digits, with single hyphens between them.',
      ],
      [
        'title="X"',
        'title=X',
        'title',
        'title must be text in double quotes, like title="Carve the chicken".',
      ],
    ])('%s -> %s', (from, to, key, sentence) => {
      expect(errorsOf(stepWith(from, to))).toEqual([
        {
          code: 'bad_value',
          line: 3,
          keyword: 'step',
          key,
          stepId: 'a.x',
          message: `Line 3: ${sentence}`,
        },
      ]);
    });
    it('a detail that is not a string', () => {
      expect(errorsOf(file('# plan "T"', '# dish a "A"', `${STEP_X} detail=more`, 'a.x:'))).toEqual(
        [
          {
            code: 'bad_value',
            line: 3,
            keyword: 'step',
            key: 'detail',
            stepId: 'a.x',
            message:
              'Line 3: detail must be text in double quotes, like detail="Use the tin juices".',
          },
        ],
      );
    });
    it('an unterminated string and a bad escape in a title', () => {
      expect(
        codesOf(
          file('# plan "T"', '# dish a "A"', `${STEP_X.replace('title="X"', 'title="X')}`, 'a.x:'),
        ),
      ).toEqual(['bad_value']);
      expect(
        codesOf(
          file('# plan "T"', '# dish a "A"', STEP_X.replace('title="X"', 'title="X\\q"'), 'a.x:'),
        ),
      ).toEqual(['bad_value']);
      expect(
        codesOf(
          file('# plan "T"', '# dish a "A"', STEP_X.replace('title="X"', 'title="X\\u12"'), 'a.x:'),
        ),
      ).toEqual(['bad_value']);
    });
    it('a kitchen count and a serving time', () => {
      expect(errorsOf(small('# kitchen burners=-1 ovens=1 cooks=1'))).toEqual([
        {
          code: 'bad_value',
          line: 5,
          keyword: 'kitchen',
          key: 'burners',
          message:
            'Line 5: burners must be a whole number with no sign or leading zero, like burners=4.',
        },
      ]);
      expect(errorsOf(small('# serve 25:00'))).toEqual([
        {
          code: 'bad_value',
          line: 5,
          keyword: 'serve',
          key: 'serve',
          message: 'Line 5: the serving time must be a 24-hour time like 19:00.',
        },
      ]);
    });
    it('a plan title that is not quoted, and a dish line with a bad id or an unquoted name', () => {
      expect(errorsOf(file('# plan T', '# dish a "A"', STEP_X, 'a.x:'))).toEqual([
        {
          code: 'bad_value',
          line: 1,
          keyword: 'plan',
          key: 'title',
          message: 'Line 1: the plan title must be text in double quotes, like "Sunday roast".',
        },
      ]);
      expect(errorsOf(file('# plan "T"', '# dish A "A"', STEP_X, 'a.x:'))).toEqual([
        {
          code: 'bad_value',
          line: 2,
          keyword: 'dish',
          key: 'dish',
          message:
            'Line 2: the dish id must be lowercase letters and digits with single hyphens, like gravy.',
        },
      ]);
      expect(errorsOf(file('# plan "T"', '# dish a A', STEP_X, 'a.x:'))).toEqual([
        {
          code: 'bad_value',
          line: 2,
          keyword: 'dish',
          key: 'name',
          message: 'Line 2: the dish name must be text in double quotes, like "Gravy".',
        },
      ]);
    });
    it('non-firing: minutes=0 and hold=0 are lexically fine, as are a 6-digit number and \\u escapes', () => {
      const ok0 = file(
        '# plan "T"',
        '# dish a "A"',
        STEP_X.replace('minutes=5', 'minutes=0').replace('hold=keeps', 'hold=0'),
        'a.x:',
      );
      expect(codesOf(ok0)).toEqual([]);
      expect(
        codesOf(
          file(
            '# plan "T"',
            '# dish a "A"',
            STEP_X.replace('minutes=5', 'minutes=999999').replace(
              'title="X"',
              'title="\\u0058\\/"',
            ),
            'a.x:',
          ),
        ),
      ).toEqual([]);
    });
  });
});

describe('R7.7 step_without_target and target_without_step', () => {
  it('a # step line followed by a blank line and the next # step line', () => {
    expect(
      errorsOf(
        file('# plan "T"', '# dish a "A"', STEP_X, '', STEP_X.replace('"X"', '"Y"'), 'a.y:'),
      ),
    ).toEqual([
      {
        code: 'step_without_target',
        line: 3,
        message:
          'Line 3: this "# step" line is not followed by a step rule. Put it directly above the rule of its step, or remove it.',
      },
    ]);
  });
  it('a # step line at the end of the text', () => {
    expect(codesOf(file('# plan "T"', '# dish a "A"', STEP_X))).toEqual(['step_without_target']);
  });
  it('a # step line followed by a rule that is not a step rule (a dish rule)', () => {
    expect(errorsOf(file('# plan "T"', '# dish a "A"', STEP_X, 'a: a.x'))).toEqual([
      {
        code: 'step_without_target',
        line: 3,
        message:
          'Line 3: this "# step" line is not followed by a step rule. Put it directly above the rule of its step, or remove it.',
      },
    ]);
  });
  it('a step rule with no # step line', () => {
    expect(errorsOf(file('# plan "T"', '# dish a "A"', 'greens.toss: greens.boil'))).toEqual([
      {
        code: 'target_without_step',
        line: 3,
        stepId: 'greens.toss',
        message:
          'Line 3: step greens.toss has no "# step" line above it. Add one, like: # step dish=greens minutes=1 appliance=none handsOn=true hold=keeps title="Describe the step"',
      },
    ]);
  });
  it('non-firing: blank lines, comments and other metadata between the # step line and its rule', () => {
    expect(
      codesOf(
        file('# plan "T"', '# dish a "A"', STEP_X, '', '# a note', '# dish b "B"', '   ', 'a.x:'),
      ),
    ).toEqual([]);
  });
  it('a # step line with a bad value still attaches: no target_without_step, and its errors carry the step id', () => {
    const errors = errorsOf(
      file('# plan "T"', '# dish a "A"', STEP_X.replace('minutes=5', 'minutes=x'), 'a.x:'),
    );
    expect(errors.map((e) => e.code)).toEqual(['bad_value']);
    expect(errors[0] && 'stepId' in errors[0] && errors[0].stepId).toBe('a.x');
  });
  it('a # step line that attaches to nothing keeps its errors without a step id', () => {
    const errors = errorsOf(
      file('# plan "T"', '# dish a "A"', STEP_X.replace('minutes=5', 'minutes=x')),
    );
    expect(errors.map((e) => [e.code, 'stepId' in e ? e.stepId : 'none'])).toEqual(
      [
        ['bad_value', 'none'],
        ['step_without_target', 'none'],
      ].map(([c, s]) => [c, s]),
    );
  });
});

describe('R7.8 duplicate_target', () => {
  it('a step rule twice: the later one is reported, with its step id and the first line', () => {
    expect(
      errorsOf(file('# plan "T"', '# dish a "A"', STEP_X, 'a.x:', STEP_X, 'a.x: a.y')),
    ).toEqual([
      {
        code: 'duplicate_target',
        line: 6,
        target: 'a.x',
        firstLine: 4,
        stepId: 'a.x',
        message:
          'Line 6: a.x is the target of a second rule (the first is line 4). Make would merge their prerequisites; keep one rule.',
      },
    ]);
  });
  it('a dish rule twice and the dinner rule twice', () => {
    expect(errorsOf(small('a: a.x', 'a: a.x', 'dinner: a.x', 'dinner: a.x'))).toEqual([
      {
        code: 'duplicate_target',
        line: 6,
        target: 'a',
        firstLine: 5,
        dishId: 'a',
        message:
          'Line 6: a is the target of a second rule (the first is line 5). Make would merge their prerequisites; keep one rule.',
      },
      {
        code: 'duplicate_target',
        line: 8,
        target: 'dinner',
        firstLine: 7,
        message:
          'Line 8: dinner is the target of a second rule (the first is line 7). Make would merge their prerequisites; keep one rule.',
      },
    ]);
  });
  it('non-firing: .PHONY twice is fine, and a dish rule and a step rule never collide', () => {
    expect(codesOf(small('.PHONY: a', '.PHONY: a.x', 'a: a.x', 'dinner: a.x'))).toEqual([]);
  });
});

describe('R7.9 dish_target_mismatch and dinner_mismatch', () => {
  const two = (...rules: string[]): string =>
    file(
      '# plan "T"',
      '# dish a "A"',
      STEP_X,
      'a.x:',
      '',
      STEP_X.replace('"X"', '"Y"'),
      'a.y: a.x',
      ...rules,
    );

  it('a dish rule that lists a step that is not a last step of the dish', () => {
    expect(errorsOf(two('a: a.x a.y'))).toEqual([
      {
        code: 'dish_target_mismatch',
        line: 8,
        dishId: 'a',
        message:
          "Line 8: the rule for dish a must list the dish's last steps: a.y. Fix it or remove the rule.",
      },
    ]);
  });
  it('a dish rule that lists too few steps (here: none)', () => {
    expect(codesOf(two('a:'))).toEqual(['dish_target_mismatch']);
  });
  it('a dish rule for a dish with no # dish line', () => {
    expect(errorsOf(two('sauce: a.y'))).toEqual([
      {
        code: 'dish_target_mismatch',
        line: 8,
        dishId: 'sauce',
        message:
          'Line 8: there is no "# dish sauce" line for the rule sauce. Add the dish or remove the rule.',
      },
    ]);
  });
  it('a dinner rule that lists a step that is not terminal, or misses one', () => {
    expect(errorsOf(two('dinner: a.x a.y'))).toEqual([
      {
        code: 'dinner_mismatch',
        line: 8,
        message:
          "Line 8: dinner must list the plan's terminal steps: a.y. Fix it or remove the rule.",
      },
    ]);
    expect(codesOf(two('dinner:'))).toEqual(['dinner_mismatch']);
  });
  it('non-firing: the right sets, in any order and with repeats, and no rule at all', () => {
    expect(codesOf(two('a: a.y a.y', 'dinner: a.y'))).toEqual([]);
    expect(codesOf(two())).toEqual([]);
  });
  it('R7.13 no mismatch is reported when another error was found', () => {
    expect(codesOf(two('a: a.x a.y', 'dinner:', 'X = 1'))).toEqual(['unsupported_line']);
  });
});

describe('R7.12 several errors, order, duplicates and the cap', () => {
  it('errors come back in line order, then by code', () => {
    const text = file(
      '# plan "T"',
      '# dish a "A"',
      STEP_X.replace('minutes=5', 'minutes=x'),
      'a.x:',
      'X = 1',
      'Foo: a.x',
      '# serve 25:00',
    );
    expect(errorsOf(text).map((e) => [e.line, e.code])).toEqual([
      [3, 'bad_value'],
      [5, 'unsupported_line'],
      [6, 'bad_target'],
      [7, 'bad_value'],
    ]);
  });
  it('missing_plan has line null and comes first', () => {
    expect(errorsOf(file('X = 1')).map((e) => [e.line, e.code])).toEqual([
      [null, 'missing_plan'],
      [1, 'unsupported_line'],
    ]);
  });
  it('two bad values on one line are two errors; the same unknown key twice is one', () => {
    expect(
      errorsOf(
        file(
          '# plan "T"',
          '# dish a "A"',
          STEP_X.replace('minutes=5', 'minutes=x').replace('hold=keeps', 'hold=y'),
          'a.x:',
        ),
      ).map((e) => 'key' in e && e.key),
    ).toEqual(['hold', 'minutes']);
    expect(codesOf(file('# plan "T"', '# dish a "A"', `${STEP_X} q=1 r=2`, 'a.x:'))).toEqual([
      'unknown_key',
    ]);
  });
  it('R7.12 at most 50 errors, then one more entry that says how many were left out', () => {
    const lines = Array.from({ length: 60 }, () => 'X = 1');
    const errors = errorsOf(file('# plan "T"', ...lines));
    expect(errors.length).toBe(51);
    expect(errors.slice(0, 50).every((e) => e.code === 'unsupported_line')).toBe(true);
    expect(errors.slice(0, 50).map((e) => e.line)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 2),
    );
    expect(errors[50]).toEqual({
      code: 'too_many_errors',
      line: 51,
      count: 10,
      message:
        'Line 51: 10 more problems were found after this point. Fix the problems above and import again.',
    });
  });
  it('exactly 50 errors are all shown, with no summary', () => {
    const lines = Array.from({ length: 50 }, () => 'X = 1');
    const errors = errorsOf(file('# plan "T"', ...lines));
    expect(errors.length).toBe(50);
    expect(errors.every((e) => e.code === 'unsupported_line')).toBe(true);
  });
  it('51 errors: 50 and a summary of 1', () => {
    const errors = errorsOf(file('# plan "T"', ...Array.from({ length: 51 }, () => 'X = 1')));
    expect(errors.length).toBe(51);
    expect(errors[50]).toMatchObject({ code: 'too_many_errors', count: 1 });
  });
  it('R7.11 messages never hold text from the file: a hostile key, id-like word and title stay out', () => {
    const hostile = file(
      '# plan "T"',
      '# dish a "A"',
      '# step dish=a minutes=5 appliance=none handsOn=true hold=keeps title="X" $(evil)=1 touch-canary=2',
      'a.x: $(evil) touch-canary',
      'rm -rf canary',
      '`touch canary`: x',
    );
    const text = errorsOf(hostile)
      .map((e) => e.message)
      .join('\n');
    expect(text.includes('evil')).toBe(false);
    expect(text.includes('canary')).toBe(false);
    expect(/^[\x20-\x7e\n]+$/.test(text)).toBe(true);
  });
});
