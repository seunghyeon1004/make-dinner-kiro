import { formatDuration } from './state/clock.js';

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
  listCritical: '▲ Critical',
  listNoSlack: 'No slack',
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

/** The slack of a step that has some: "Slack 1 h 15 min". */
export function slackLabel(minutes: number): string {
  return `Slack ${formatDuration(minutes)}`;
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
  return titles.length === 0 ? '' : ` ${titles.join(', ')} no longer wait for it.`;
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
