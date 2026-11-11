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
