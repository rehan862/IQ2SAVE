const KEY = 'clipmate.theme';
const VALID = ['system', 'light', 'dark'];
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function getPreference() {
  try {
    const stored = localStorage.getItem(KEY);
    if (VALID.includes(stored)) return stored;
  } catch {
    /* private mode */
  }
  return 'system';
}

export function resolved(preference = getPreference()) {
  if (preference === 'system') return media.matches ? 'dark' : 'light';
  return preference;
}

function apply(preference) {
  const theme = resolved(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#080d18' : '#0b1220');
  for (const fn of listeners) fn(preference, theme);
}

export function setPreference(preference) {
  const next = VALID.includes(preference) ? preference : 'system';
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  apply(next);
}

/** Cycle used by the header button: whatever is showing now flips to the other. */
export function toggleTheme() {
  setPreference(resolved() === 'dark' ? 'light' : 'dark');
  return resolved();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  apply(getPreference());
  media.addEventListener('change', () => {
    if (getPreference() === 'system') apply('system');
  });
}
