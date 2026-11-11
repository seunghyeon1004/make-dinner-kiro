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
