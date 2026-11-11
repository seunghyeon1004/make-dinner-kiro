import type { ParseFailure } from './state/api.js';
import { formatClock, formatDuration } from './state/clock.js';

/**
 * Every string the cook sees (plan-ui R10.3). Pure: no DOM, no clock.
 * Sentence case, no exclamation marks, glossary words only (ui.md, "Copy").
 */
export const COPY = {
  brand: 'Make Dinner',
  titleSuffix: 'Make Dinner',

  // Navigation
  navLabel: 'Dinner',
  navMenu: 'Menu',
  navSteps: 'Steps',
  navPlan: 'Plan',
  navCook: 'Cook',
  reasonPickDinner: 'Pick a dinner first',
  reasonFixErrors: 'Fix the errors in Steps first',
  reasonMakePlan: 'Make the plan first',
  reasonCookMissing: 'Cooking mode is not available yet',

  // Headings
  menuHeading: 'Pick a dinner',
  stepsHeading: 'Check the steps',
  planHeading: 'Plan',

  // Menu
  menuIntro: 'Pick a sample dinner, paste your own recipes, or open a Dinnerfile.',
  samplesHeading: 'Sample dinners',
  planThisDinner: 'Plan this dinner',
  samplesLoading: 'Loading the sample dinners.',
  samplesFailed: 'The sample dinners could not be loaded. Check your connection and try again.',
  tryAgain: 'Try again',
  replaceIt: 'Replace it',
  keepMine: 'Keep my dinner',

  // Header
  settings: 'Settings',
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  startOver: 'Start over',
  startOverAsk: 'Start over? This removes your dinner from this device.',
  startOverYes: 'Yes, start over',
  cancel: 'Cancel',

  // Stored state
  savedUnreadable: 'Your saved dinner could not be read, so the app started fresh.',
  saveFailed: 'This browser did not let the app save your dinner, so a reload will lose it.',

  // Plan screen
  kitchenHeading: 'Kitchen',
  timelineHeading: 'Timeline',
  planListHeading: 'Plan list',
  warningsHeading: 'Warnings',
  burners: 'Burners',
  ovens: 'Ovens',
  cooks: 'Cooks',
  servingTime: 'Serving time',
  noWarnings: 'No warnings. Every result is used within the time it can wait.',
  addOven: 'Add an oven',
  addBurner: 'Add a burner',
  changeSteps: 'Change the steps',
  invalidPlan: 'This plan has errors, so it cannot be scheduled. Fix them in Steps.',
  goToSteps: 'Go to steps',

  skipToList: 'Skip to the plan list',

  // Plan list
  listCritical: '▲ On the critical path',
  listServe: 'Serve',
  handsFree: 'Hands-free',

  // Error boundary
  errorHeading: 'Something went wrong',
  errorBody:
    'Something went wrong in the app. Your dinner is saved on this device. Reload the page to try again.',
  reload: 'Reload',
} as const;

export type ScreenKey = 'menu' | 'steps' | 'plan' | 'cook';

/** The document title of a screen: "<screen> · Make Dinner". */
export function documentTitle(screen: string): string {
  return `${screen} · ${COPY.titleSuffix}`;
}

/** The dish names of a sample card: "Dishes: Roast chicken, Gravy". */
export function dishesLine(names: readonly string[]): string {
  return `Dishes: ${names.join(', ')}`;
}

/** The question before a loaded dinner replaces the current one (R1.5, R8.6). */
export function replaceAsk(currentTitle: string): string {
  return `Replace your current dinner, ${currentTitle}?`;
}

/** The warning on a plan list item: "! Warning: waits 40 min and can wait 10 min". */
export function listWait(waitMin: number, holdMin: number): string {
  return `! Warning: waits ${formatDuration(waitMin)} and can wait ${formatDuration(holdMin)}`;
}

/** The slack of a step that has some: "Can slip 1 h 15 min". */
export function slackLabel(minutes: number): string {
  return `Can slip ${formatDuration(minutes)}`;
}

/** A lane in text: "Burner 2", "Oven 1", "Cook 1". */
export function laneName(resource: 'burner' | 'oven' | 'cook', lane: number): string {
  const name = resource === 'burner' ? 'Burner' : resource === 'oven' ? 'Oven' : 'Cook';
  return `${name} ${lane}`;
}

/** The button names of a stepper: "Fewer burners", "More burners". */
export function fewer(what: string): string {
  return `Fewer ${what.toLowerCase()}`;
}
export function more(what: string): string {
  return `More ${what.toLowerCase()}`;
}

export function startAt(time: string): string {
  return `Start at ${time}`;
}

/** "Serve at 19:30", with the day when it is not today: "Serve at 00:30 tomorrow". */
export function serveAt(time: string, day: string | null): string {
  return day === null ? `Serve at ${time}` : `Serve at ${time} ${day}`;
}

export function takes(duration: string): string {
  return `Takes ${duration}`;
}

/**
 * A hold warning (R5.6). `userTitle` is the title of the step that uses the result first;
 * null for a terminal step, whose result waits for serving.
 */
export function holdWarning(
  dish: string,
  title: string,
  waitMin: number,
  holdMin: number,
  userTitle: string | null,
): string {
  const until = userTitle === null ? 'serving' : `\u201c${userTitle}\u201d starts`;
  return `${dish}: \u201c${title}\u201d will be ready ${formatDuration(waitMin)} before ${until} and can wait only ${formatDuration(holdMin)}. More ovens, burners or cooks may help.`;
}

/** The missing appliance sentence: "This plan needs an oven and the kitchen has none. These steps use it: ...". */
export function missingAppliance(appliance: 'burner' | 'oven', titles: readonly string[]): string {
  const what = appliance === 'oven' ? 'an oven' : 'a burner';
  return `This plan needs ${what} and the kitchen has none. These steps use it: ${titles.join(', ')}.`;
}

/** The note when the start is already past (R5.5). */
export function pastStart(duration: string, earliest: string): string {
  return `This dinner needs ${duration}. Earliest serving time ${earliest}.`;
}

export function serveAtButton(time: string): string {
  return `Serve at ${time}`;
}

/** The serve line's label: "Serve 19:30". */
export function serveLabel(time: string): string {
  return `Serve ${time}`;
}

/** The sentence after a removal when other steps waited for it (R4.7). */
function noLongerWait(titles: readonly string[]): string {
  if (titles.length === 0) return '';
  return ` ${titles.join(', ')} no longer ${titles.length === 1 ? 'waits' : 'wait'} for it.`;
}

/** The notice after a step is removed; `dependentTitles` are the steps that waited for it. */
export function removedStep(title: string, dependentTitles: readonly string[]): string {
  return `Removed \u201c${title}\u201d.${noLongerWait(dependentTitles)}`;
}

/** The notice after a dish and its steps are removed. */
export function removedDish(name: string, dependentTitles: readonly string[]): string {
  return `Removed the dish ${name}.${noLongerWait(dependentTitles)}`;
}

/** Limits and field errors of the Steps screen (R4.4, R4.8). */
export const EDIT_ERRORS = {
  too_many_dishes: 'A plan can have at most 12 dishes.',
  too_many_steps: 'A plan can have at most 80 steps.',
  last_step: 'A plan needs at least one step.',
  last_dish: 'A plan needs at least one dish.',
  invalid_name: 'Give the dish a name.',
  invalid_step: 'This step cannot be saved as it is.',
} as const;

// Steps screen (T5)
export const STEPS_COPY = {
  issuesHeading: 'Issues',
  noIssues: 'No issues.',
  fixErrorsToMake: 'Fix the errors to make the plan.',
  makePlan: 'Make the plan',
  error: 'Error',
  warning: 'Warning',
  noAppliance: 'No appliance',
  burner: 'Burner',
  oven: 'Oven',
  handsOn: 'Hands-on',
  handsFree: 'Hands-free',
  keeps: 'Keeps',
  waitsForNothing: 'Waits for nothing',
  cookingStarted: 'Cooking has started, so the plan cannot be changed here.',
  noDishHeading: 'Steps with no dish',
  noDishHint: 'These steps name a dish that is not in the plan. Edit each one to pick a dish.',
} as const;

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The intro under the Steps heading: "Sunday roast. Fix any errors, then make the plan." */
export function stepsIntro(title: string): string {
  return `${title}. Fix any errors, then make the plan.`;
}

/** "1 error and 0 warnings." */
export function issueSummary(errors: number, warnings: number): string {
  return `${count(errors, 'error', 'errors')} and ${count(warnings, 'warning', 'warnings')}.`;
}

/** The reason "Make the plan" is disabled: "Fix 1 error to make the plan." */
export function makeBlocked(errors: number): string {
  return `Fix ${count(errors, 'error', 'errors')} to make the plan.`;
}

export function applianceLabel(appliance: 'burner' | 'oven' | 'none'): string {
  if (appliance === 'burner') return STEPS_COPY.burner;
  if (appliance === 'oven') return STEPS_COPY.oven;
  return STEPS_COPY.noAppliance;
}

export function handsLabel(handsOn: boolean): string {
  return handsOn ? STEPS_COPY.handsOn : STEPS_COPY.handsFree;
}

/** "Keeps" or "Can wait 5 min". */
export function holdLabel(holdMin: number | null): string {
  return holdMin === null ? STEPS_COPY.keeps : `Can wait ${formatDuration(holdMin)}`;
}

/** "Waits for: Season and truss the chicken" or "Waits for nothing". */
export function waitsFor(titles: readonly string[]): string {
  return titles.length === 0 ? STEPS_COPY.waitsForNothing : `Waits for: ${titles.join(', ')}`;
}

// Step editor (T5.5)
export const EDITOR_COPY = {
  edit: 'Edit',
  doneEditing: 'Done editing',
  title: 'Title',
  minutes: 'Minutes',
  appliance: 'Appliance',
  handsOn: 'Hands-on (needs a cook the whole time)',
  dish: 'Dish',
  keeps: 'Keeps (can wait as long as needed)',
  canWaitUpTo: 'Can wait up to (minutes)',
  waitsFor: 'Waits for',
  alreadyWaits: '(already waits for this step)',
  notAStep: '(not a step in this plan)',
  thisStep: '(this step)',
  notADish: '(not a dish in this plan)',
  titleError: 'Give the step a title.',
  minutesError: 'Enter whole minutes from 1 to 480.',
  holdError: 'Enter whole minutes from 0 to 480.',
} as const;

// Add, rename and remove (T5.6)
export const MANAGE_COPY = {
  removeStep: 'Remove step',
  keepStep: 'Keep step',
  removeDish: 'Remove dish',
  keepDish: 'Keep dish',
  renameDish: 'Rename dish',
  dishName: 'Dish name',
  saveName: 'Save name',
  addStep: 'Add a step',
  addDish: 'Add a dish',
  addDishConfirm: 'Add dish',
  nameError: 'Give the dish a name.',
} as const;

function dependentsSentence(titles: readonly string[]): string {
  if (titles.length === 0) return '';
  const list = titles.join(', ');
  return titles.length === 1
    ? ` 1 step waits for it: ${list}. It will no longer wait for it.`
    : ` ${titles.length} steps wait for it: ${list}. They will no longer wait for it.`;
}

/** The question before a step is removed; `dependentTitles` are the steps that wait for it. */
export function removeStepAsk(title: string, dependentTitles: readonly string[]): string {
  return `Remove \u201c${title}\u201d?${dependentsSentence(dependentTitles)}`;
}

/** The question before a dish and its steps are removed. */
export function removeDishAsk(
  name: string,
  stepCount: number,
  dependentTitles: readonly string[],
): string {
  return `Remove the dish ${name} and its ${count(stepCount, 'step', 'steps')}?${dependentsSentence(dependentTitles)}`;
}

// Paste recipes (T6.3)
export const PASTE_COPY = {
  heading: 'Your own recipes',
  label: 'Recipe text',
  hint: 'Paste the recipes for every dish of one dinner.',
  submit: 'Read recipes',
  cancel: 'Cancel',
  empty: 'Paste at least one recipe.',
  tooLong: 'The recipe text is over 12,000 characters. Shorten it or split it into two dinners.',
  busy: 'Reading your recipes. This can take up to a minute.',
  stopped: 'Stopped reading the recipes.',
} as const;

/** The counter under the recipe text: "9 of 12,000 characters"; `n` is in code points. */
export function recipeCounter(n: number): string {
  return `${n.toLocaleString('en-US')} of 12,000 characters`;
}

/** The elapsed seconds of a running request: "5 s". */
export function elapsedSeconds(seconds: number): string {
  return `${seconds} s`;
}

const MEANWHILE = 'Meanwhile, sample dinners and Dinnerfiles still work.';
const INSTEAD = 'Use a sample dinner or open a Dinnerfile instead.';

/** What happened and what to do next, for a parse that gave no plan (R2.6, R2.7). */
export function parseFailureText(failure: ParseFailure, locale?: string): string {
  switch (failure.kind) {
    case 'bad_request':
      return 'The recipe reader could not read this request. Reload the page and try again.';
    case 'input_too_long':
      return PASTE_COPY.tooLong;
    case 'rate_limited': {
      const when =
        failure.retryAtMs === null
          ? 'Try again in a few minutes.'
          : `Try again after ${formatClock(failure.retryAtMs, locale)}.`;
      return `You have read several recipes in a short time. ${when} ${MEANWHILE}`;
    }
    case 'daily_cap_reached': {
      const when =
        failure.retryAtMs === null ? 'tomorrow' : `at ${formatClock(failure.retryAtMs, locale)}`;
      return `The recipe reader has reached its limit for today. It starts again ${when}. ${INSTEAD}`;
    }
    case 'model_unavailable':
      return `The recipe reader is not available on this server right now. ${INSTEAD}`;
    case 'model_refused':
      return 'The recipe reader declined to read this text. Check that it is a recipe, or use a sample dinner.';
    case 'model_output_invalid':
      return 'The recipe reader returned steps this app cannot use. Try again, or paste fewer dishes at a time.';
    case 'network':
      return 'The server could not be reached. Check your connection and try again. Sample dinners you have opened and Dinnerfiles work offline.';
    case 'internal':
    case 'unexpected':
      return 'Something went wrong on the server. Try again, or use a sample dinner or a Dinnerfile.';
  }
}

// Dinnerfile import (T6.4, T6.5)
export const DINNERFILE_COPY = {
  heading: 'A Dinnerfile',
  label: 'Dinnerfile text',
  open: 'Open Dinnerfile',
  fileLabel: 'Open a Dinnerfile from this device',
  unreadable: 'This Dinnerfile could not be read. Fix these lines and open it again.',
  invalidPlan: 'This Dinnerfile was read, but its plan is not valid:',
  kitchenLineIgnored:
    'The kitchen line in the Dinnerfile is not valid, so the usual kitchen is used: 4 burners, 1 oven, 1 cook.',
  fileTooLarge: 'This file is over 1 MB, so it is not a Dinnerfile from this app.',
  fileUnreadable: 'This file could not be read. Paste its text instead.',
  empty: 'Paste a Dinnerfile or open one from this device.',
} as const;

/** The button beside a line problem: "Show line 57". */
export function showLine(line: number): string {
  return `Show line ${line}`;
}

// Share links (T7.3)
export const SHARE_COPY = {
  opened: 'Opened a shared dinner.',
  damaged:
    'This share link is damaged or incomplete, so it could not be opened. Ask for the link again, or open a Dinnerfile.',
  version: 'This share link was made by a newer version of Make Dinner and cannot be opened here.',
  invalidPlan: 'This share link holds a plan with errors, so it could not be opened.',
} as const;

// Export (T7.4)
export const EXPORT_COPY = {
  heading: 'Take the plan with you',
  dinnerfile: 'Dinnerfile',
  shareLink: 'Share link',
  print: 'Print',
  copy: 'Copy',
  download: 'Download',
  copyLink: 'Copy link',
  linkLabel: 'Link to this dinner',
  makeLine:
    'Run make -n -f Dinnerfile dinner to see GNU Make print the steps in an order that works.',
  copiedDinnerfile: 'Copied the Dinnerfile.',
  copiedLink:
    'Copied a link to this dinner. The plan is in the link itself; nothing is stored on the server.',
  copyFailed: "Could not copy. The text is selected; copy it with your device's copy command.",
} as const;

/** The share panel when the link would be over the limit (R8.4); `length` counts the whole URL. */
export function shareTooLong(length: number): string {
  return `This plan is too long for a link (${length.toLocaleString('en-US')} characters; the limit is 8,000). Share the Dinnerfile instead.`;
}

// Cooking mode announcements (cooking-mode design, "Announcements"). The polite live region
// reads these; countdown ticks are never announced.
export const COOK_ANNOUNCE = {
  rebuildFailed: 'The plan could not be rebuilt.',
  rebuiltOnTime: 'Plan rebuilt: everything is on time.',
  finished: 'Everything is done. Dinner is served.',
} as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Plan rebuilt: 7 steps moved. Serving is now 19:45. 1 new warning." */
export function cookRebuilt(
  movedCount: number,
  servingMoved: boolean,
  servingTime: string,
  newWarningCount: number,
): string {
  const warnings =
    newWarningCount > 0 ? ` ${plural(newWarningCount, 'new warning', 'new warnings')}.` : '';
  if (movedCount === 0 && !servingMoved) return `${COOK_ANNOUNCE.rebuiltOnTime}${warnings}`;
  const serving = servingMoved
    ? `Serving is now ${servingTime}.`
    : `Serving stays at ${servingTime}.`;
  return `Plan rebuilt: ${plural(movedCount, 'step', 'steps')} moved. ${serving}${warnings}`;
}

/** "Undone: +15 min on Roast the chicken." */
export function cookUndone(words: string): string {
  return `Undone: ${words}.`;
}

/** "Time is up: Roast the chicken." (several titles joined with a comma). */
export function cookTimeUp(titles: readonly string[]): string {
  return `Time is up: ${titles.join(', ')}.`;
}
