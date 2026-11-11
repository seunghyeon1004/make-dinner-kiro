/**
 * Recipe text in one normal form (R9.1, tech.md "Normalisation"): Unicode NFC, CRLF and then
 * any lone CR to LF, trailing white space removed from every line, runs of blank lines
 * collapsed to one, the whole text trimmed.
 */
export function normaliseRecipeText(text: string): string {
  return text
    .normalize('NFC')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
