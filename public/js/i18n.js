const KEY = 'clipmate.lang';
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
];

const cache = new Map();
const listeners = new Set();
let dict = {};
let current = 'en';

export function getLanguage() {
  return current;
}

function storedLanguage() {
  try {
    const stored = localStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch {
    /* ignore */
  }
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.code === browser) ? browser : 'en';
}

export function t(key, fallback) {
  const value = dict[key];
  if (typeof value === 'string') return value;
  return fallback ?? key;
}

async function fetchDict(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const response = await fetch(`/locales/${lang}.json`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Missing locale: ${lang}`);
  const parsed = await response.json();
  cache.set(lang, parsed);
  return parsed;
}

/**
 * Swaps text for every element carrying a data-i18n* attribute. Values are
 * written with textContent / setAttribute so a translation can never inject markup.
 */
export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const value = dict[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  }
  const attrs = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title', 'title'],
    ['data-i18n-value', 'value'],
  ];
  for (const [dataAttr, target] of attrs) {
    for (const el of root.querySelectorAll(`[${dataAttr}]`)) {
      const value = dict[el.getAttribute(dataAttr)];
      if (typeof value === 'string') el.setAttribute(target, value);
    }
  }
  const title = dict[document.documentElement.dataset.pageTitleKey ?? ''];
  if (title) document.title = `${title} · ${t('brand.name', 'IQ2SAVE')}`;
}

export async function setLanguage(lang) {
  const next = LANGUAGES.some((l) => l.code === lang) ? lang : 'en';
  dict = await fetchDict(next);
  current = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  applyTranslations();
  for (const fn of listeners) fn(next);
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initI18n() {
  const lang = storedLanguage();
  try {
    dict = await fetchDict(lang);
    current = lang;
  } catch {
    dict = await fetchDict('en').catch(() => ({}));
    current = 'en';
  }
  document.documentElement.lang = current;
  applyTranslations();
  return current;
}
