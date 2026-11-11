/** Writes text to the clipboard; false when the browser refuses or has no clipboard (R8.7). */
export async function copyText(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  text: string,
): Promise<boolean> {
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Offers `text` as a download named `filename` (R8.2). The type is `text/x-makefile`, not
 * `text/plain`: Chromium adds ".txt" to a text/plain download that has no extension, and
 * `make -f Dinnerfile` needs the file to keep its name (decided in the T7.4 session).
 */
export function downloadText(doc: Document, filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/x-makefile;charset=utf-8' }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Selects everything inside `element`, so the cook can copy by hand. */
export function selectContents(doc: Document, element: Element): void {
  const selection = doc.defaultView?.getSelection();
  if (selection === null || selection === undefined) return;
  selection.removeAllRanges();
  const range = doc.createRange();
  range.selectNodeContents(element);
  selection.addRange(range);
}
