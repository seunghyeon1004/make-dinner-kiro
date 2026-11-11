// Sets data-theme from the stored choice before the first paint, so a stored Dark or Light
// does not flash the system theme. A classic blocking script in <head>, not inline, so a
// strict Content-Security-Policy still holds. Keep the key in step with src/web/state/persist.ts.
(function () {
  try {
    var stored = JSON.parse(window.localStorage.getItem('make-dinner:state') || 'null');
    var theme = stored && stored.theme;
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch {
    // Storage blocked or unreadable: the app starts with the system theme.
  }
})();
