import type { ParseFailure } from './state/api.js';
import { clockAt, formatClock, formatDuration } from './state/clock.js';
import type { LogCause, LogEntry, UndoLabel } from './state/cook-slot.js';

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

// Cooking mode (cooking-mode design, "Copy"). Marks such as `!` and `✓` are drawn by the
// components next to these words; the strings here carry the words only.
export const COOK_COPY = {
  documentTitle: 'Cook',
  h1: 'Right now',
  doNow: 'Do now',
  dockLabel: 'Actions',
  running: 'Running',
  upNext: 'Up next',
  dishes: 'Dishes',
  buildLog: 'Build log',
  soundAndScreen: 'Sound and screen',
  countdownLabel: 'Time until cooking starts',
  timeLeft: 'Time left',
  timeIsUp: 'Time is up',
  start: 'Start',
  done: 'Done',
  startNow: 'Start now',
  behind: "I'm behind",
  needsMoreTime: 'Needs more time',
  startThenLeave: 'Start, then leave it',
  alsoDue: 'Also due',
  nothingToDo: 'Nothing to do now',
  nothingMore: 'Nothing more for this cook.',
  startAnyway: 'Start anyway',
  notYet: 'Not yet',
  nothingElse: 'Nothing else is planned.',
  logEmpty: 'No rebuilds yet.',
  onTime: 'Everything is on time',
  alertsButton: 'Sound and vibration',
  alertsOff: 'Off',
  alertsOn: 'On',
  wakeNote:
    'The screen may turn off while you cook. To keep it on, set Auto-Lock or Screen timeout to a longer time in your device settings.',
  finishedHeading: 'Dinner is served',
  backToPlan: 'Back to the plan',
  staleHeading: 'Carry on with this dinner?',
  resume: 'Resume',
  discard: 'Discard',
  discardAsk: 'Discard the recorded times?',
  discardYes: 'Yes, discard',
  stopCooking: 'Stop cooking',
  stopAsk: 'Stop cooking? The times you recorded will be cleared.',
  stopYes: 'Yes, stop cooking',
  keepCooking: 'Keep cooking',
  goToPlan: 'Go to the plan',
  startCooking: 'Start cooking',
  cookingNote: 'You are cooking this dinner.',
  continueCooking: 'Continue cooking',
  storedBad:
    'Your cooking session could not be read, so it was cleared. Your dinner is still here.',
} as const;

export type { LogCause };

/** A build log line: the mono text shown, and the sentence read by screen readers (ui.md). */
export interface LogLine {
  mono: string;
  sentence: string;
}
export interface LogLines {
  cause: LogLine;
  moves: LogLine[];
  unchanged: LogLine | null;
  serving: LogLine | null;
  nothing: LogLine | null;
  failed: LogLine | null;
  upToDate: LogLine[];
}
export interface LogContext {
  axisMs: number;
  titleOf(stepId: string): string;
  locale?: string | undefined;
}

function causeWords(cause: LogCause, name: (id: string) => string): string {
  switch (cause.kind) {
    case 'begin-late':
      return `started ${formatDuration(cause.byMin)} late`;
    case 'start':
    case 'done': {
      const verb = cause.kind === 'start' ? 'started' : 'done';
      const how = cause.byMin >= 0 ? 'late' : 'early';
      return `${name(cause.stepId)} ${verb} ${formatDuration(Math.abs(cause.byMin))} ${how}`;
    }
    case 'extra':
      return `${name(cause.stepId)} needs ${cause.minutes} more min`;
    case 'behind':
      return COOK_COPY.behind;
  }
}

/** Every line of one build log entry (design, "Build log lines"). */
export function cookLogLines(entry: LogEntry, ctx: LogContext): LogLines {
  const at = formatClock(entry.atMs, ctx.locale);
  const time = (min: number): string => formatClock(clockAt(ctx.axisMs, min), ctx.locale);
  const cause: LogLine = {
    mono: `${at} rebuild: ${causeWords(entry.cause, (id) => id)}`,
    sentence: `Rebuilt at ${at}: ${causeWords(entry.cause, ctx.titleOf)}.`,
  };
  const lines: LogLines = {
    cause,
    moves: [],
    unchanged: null,
    serving: null,
    nothing: null,
    failed: null,
    upToDate: [],
  };
  const { result } = entry;
  if (!result.ok) {
    lines.failed = {
      mono: `rebuild failed: ${result.error}`,
      sentence:
        "The plan could not be rebuilt, so it is unchanged. Carry on by the times shown and tap I'm behind to try again.",
    };
    return lines;
  }
  lines.moves = result.moved.map((move) => {
    const from = time(move.fromStartMin);
    const to = time(move.toStartMin);
    return {
      mono: `${move.stepId} ${from} -> ${to}`,
      sentence: `${ctx.titleOf(move.stepId)} moved from ${from} to ${to}.`,
    };
  });
  if (result.unchanged.length > 0) {
    const text = `${plural(result.unchanged.length, 'step', 'steps')} up to date`;
    lines.unchanged = { mono: text, sentence: `${text}.` };
  }
  const servingMoved = result.servingToMin !== result.servingFromMin;
  if (servingMoved) {
    const from = time(result.servingFromMin);
    const to = time(result.servingToMin);
    lines.serving = {
      mono: `serve ${from} -> ${to}`,
      sentence: `Serving moved from ${from} to ${to}.`,
    };
  }
  if (result.moved.length === 0 && !servingMoved) {
    lines.nothing = { mono: COOK_COPY.onTime, sentence: `${COOK_COPY.onTime}.` };
  }
  lines.upToDate = result.unchanged.map((id) => ({
    mono: `${id} is up to date`,
    sentence: `${ctx.titleOf(id)} is up to date.`,
  }));
  return lines;
}

/** "10:00", "69:00", and "+02:10" once over. Whole seconds, rounded up. */
export function cookCountdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const abs = Math.abs(seconds);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const text = `${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return seconds < 0 ? `+${text}` : text;
}

/** The words of an undo, used by the Undo button and the "Undone" announcement. */
export function cookUndoWords(label: UndoLabel, title: string): string {
  switch (label.kind) {
    case 'start':
      return `started ${title}`;
    case 'done':
      return `done ${title}`;
    case 'extra':
      return `+${label.minutes} min on ${title}`;
    case 'behind':
      return COOK_COPY.behind;
    case 'start-now':
      return 'start now';
  }
}
export const cookUndoButton = (words: string): string => `Undo: ${words}`;

export const cookStartsAt = (time: string): string => `Cooking starts at ${time}`;
export const cookPlannedFor = (time: string): string => `Planned for ${time}`;
export function cookFirst(items: readonly { title: string; dish: string }[]): string {
  return `First: ${items.map((item) => `${item.title} (${item.dish})`).join('; ')}`;
}
export function cookStartNow(time: string, minutes: number): string {
  return `Start now to serve at ${time}, ${formatDuration(minutes)} earlier.`;
}

export function cookDue(dish: string, minutes: number, time: string, since: boolean): string {
  return `${dish} \u00b7 ${formatDuration(minutes)} \u00b7 due ${since ? 'since ' : ''}${time}`;
}
export const cookReady = (dish: string, time: string): string => `${dish} \u00b7 ready at ${time}`;
const quoted = (titles: readonly string[]): string =>
  titles.map((title) => `\u201c${title}\u201d`).join(', ');
export const cookWaitsFor = (titles: readonly string[]): string =>
  `Waits for ${quoted(titles)}, not done yet.`;
export function cookNext(title: string, time: string, inMin: number): string {
  return `Next: ${title} at ${time}, in ${formatDuration(inMin)}.`;
}
export const cookLate = (minutes: number): string => `Late by ${formatDuration(minutes)}`;
export const cookIn = (minutes: number): string => `in ${formatDuration(minutes)}`;
export const cookExtra = (minutes: number): string => `+${minutes} min`;
export function cookBlockedAsk(title: string, titles: readonly string[]): string {
  return `${title} waits for ${quoted(titles)}, not done yet. Start it anyway?`;
}

export const cookDishChip = (name: string, done: number, total: number): string =>
  `${name}: ${done} of ${total} done`;
export function cookDishState(kind: 'done' | 'cooking' | 'due' | 'next', time: string): string {
  switch (kind) {
    case 'done':
      return 'Done';
    case 'cooking':
      return 'Cooking';
    case 'due':
      return 'Due now';
    case 'next':
      return `Next at ${time}`;
  }
}

export const cookEarlier = (n: number): string => `Earlier rebuilds (${n})`;
export const cookHideUpToDate = (): string => 'Hide the steps that are up to date';
export const cookShowUpToDate = (n: number): string =>
  `Show the ${n} ${n === 1 ? 'step that is' : 'steps that are'} up to date`;

/** `lateMin` is served minus planned: 0 on time, positive later, negative earlier. */
export function cookFinishedLine(served: string, planned: string, lateMin: number): string {
  const how =
    lateMin === 0
      ? 'on time'
      : `${formatDuration(Math.abs(lateMin))} ${lateMin > 0 ? 'later' : 'earlier'}`;
  return `Served at ${served}. Planned for ${planned}: ${how}.`;
}
export function cookStaleBody(title: string, weekday: string, time: string): string {
  return `You started cooking ${title} on ${weekday} at ${time}, more than 8 hours ago.`;
}
export function cookTooLate(time: string, day: string | null): string {
  const when = day === null ? time : `${time} ${day}`;
  return `This plan was for ${when}, too long ago to cook against. Choose a new serving time on the Plan screen.`;
}

export function cookAlertsText(mode: 'off' | 'on' | 'reload', canVibrate: boolean): string {
  const base =
    mode === 'off'
      ? 'Turn on to hear a chime and feel a buzz when a timer ends. The browser allows sound only after you tap here.'
      : mode === 'on'
        ? 'A chime and a buzz play when a timer ends. Silent mode may still mute them.'
        : 'Sound was on before the page reloaded. Tap once to turn it on again.';
  return canVibrate ? base : `${base} This device cannot vibrate.`;
}
export const cookStartReached = (titles: readonly string[]): string =>
  `Time to start: ${titles.join(', ')}.`;
