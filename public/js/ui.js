import { LANGUAGES, applyTranslations, getLanguage, initI18n, setLanguage, t } from './i18n.js';
import { initTheme, resolved, toggleTheme } from './theme.js';

/* ---------- tiny DOM helpers ---------- */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [children].flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an inline icon from path data. Keeps markup out of innerHTML. */
export function icon(paths, { size = 20, fill = false, fillRule = null } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', fill ? 'currentColor' : 'none');
  if (fillRule) svg.setAttribute('fill-rule', fillRule);
  if (!fill) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of [paths].flat()) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const ICONS = {
  download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 19h16'],
  link: ['M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'],
  film: ['M4 4h16v16H4z', 'M4 9h16', 'M4 15h16', 'M9 4v16', 'M15 4v16'],
  music: ['M9 18V6l10-2v12', 'M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z', 'M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'],
  wand: ['M15 4V2', 'M15 10V8', 'M12.5 6H10.5', 'M19.5 6h-2', 'M4 20 14 10', 'M14 10l2 2'],
  sun: ['M12 4V2', 'M12 22v-2', 'M4 12H2', 'M22 12h-2', 'M5.6 5.6 4.2 4.2', 'M19.8 19.8l-1.4-1.4', 'M18.4 5.6l1.4-1.4', 'M4.2 19.8l1.4-1.4', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  check: ['M4 12.5 9.5 18 20 6.5'],
  alert: ['M12 8v5', 'M12 17h.01', 'M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  info: ['M12 11v6', 'M12 7.5h.01', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  library: ['M4 5h4v14H4z', 'M10 5h4v14h-4z', 'M16.5 5.6l3.4 13.1'],
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z', 'M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 4a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20 10.6a2 2 0 1 1 0 4Z'],
  home: ['M4 11 12 4l8 7', 'M6 10v10h12V10'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v5l3 2'],
  file: ['M6 3h7l5 5v13H6z', 'M13 3v5h5'],
  shield: ['M12 3 5 6v5c0 4.4 2.9 8.4 7 9.6 4.1-1.2 7-5.2 7-9.6V6l-7-3Z'],
  bolt: ['M13 3 5 13h6l-1 8 8-10h-6l1-8Z'],
  cancel: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M8 8l8 8'],
  // Brand marks. YouTube is one filled shape whose play triangle is a second
  // subpath, so it only reads correctly with fill-rule: evenodd.
  youtube: [
    'M12 4.5c-3.1 0-6 .2-7.6.5a2.9 2.9 0 0 0-2.2 2.1C1.9 8.4 1.8 10.1 1.8 12s.1 3.6.4 4.9a2.9 2.9 0 0 0 2.2 2.1c1.6.3 4.5.5 7.6.5s6-.2 7.6-.5a2.9 2.9 0 0 0 2.2-2.1c.3-1.3.4-3 .4-4.9s-.1-3.6-.4-4.9a2.9 2.9 0 0 0-2.2-2.1C18 4.7 15.1 4.5 12 4.5Z',
    'M10 8.8v6.4L15.8 12 10 8.8Z',
  ],
  instagram: [
    'M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Z',
    'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z',
    'M16.9 7.1h.01',
  ],
};

/* ---------- formatters ---------- */

export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return null;
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(scaled >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const total = Math.round(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSpeed(bytesPerSecond) {
  const value = formatBytes(bytesPerSecond);
  return value ? `${value}/s` : null;
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(Number(timestamp)).toLocaleString(getLanguage() === 'hi' ? 'hi-IN' : undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/* ---------- toasts ---------- */

let toastRegion = null;

function ensureToastRegion() {
  if (toastRegion?.isConnected) return toastRegion;
  toastRegion = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
  document.body.append(toastRegion);
  return toastRegion;
}

export function toast(message, type = 'info', { timeout = 4200 } = {}) {
  const region = ensureToastRegion();
  const glyph = type === 'success' ? ICONS.check : type === 'error' ? ICONS.alert : ICONS.info;
  const node = el('div', { class: `toast ${type}` }, [
    icon(glyph, { size: 18 }),
    el('span', { text: message }),
    el(
      'button',
      { class: 'toast-close', type: 'button', 'aria-label': t('nav.close', 'Close'), onClick: () => node.remove() },
      [icon(ICONS.close, { size: 16 })],
    ),
  ]);
  region.append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

/* ---------- button states ---------- */

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel ??= button.querySelector('span')?.textContent ?? button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
  const span = button.querySelector('span');
  const text = label ?? (busy ? null : button.dataset.idleLabel);
  if (span && text) span.textContent = text;
  const existing = button.querySelector('.spinner');
  if (busy && !existing) button.prepend(el('span', { class: 'spinner', 'aria-hidden': 'true' }));
  if (!busy) existing?.remove();
}

export function flashButton(button, state) {
  if (!button) return;
  button.classList.add(state);
  setTimeout(() => button.classList.remove(state), 1600);
}

/* ---------- ripple ---------- */

function attachRipple() {
  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest?.('.btn');
    if (!button || button.disabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const dot = el('span', { class: 'ripple', 'aria-hidden': 'true' });
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.left = `${event.clientX - rect.left - size / 2}px`;
    dot.style.top = `${event.clientY - rect.top - size / 2}px`;
    button.append(dot);
    setTimeout(() => dot.remove(), 650);
  });
}

/* ---------- bottom sheet ---------- */

export function openSheet(title, contentNode) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    el('h3', { text: title }),
    contentNode,
  ]);
  backdrop.append(sheet);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 260);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  return close;
}

/* ---------- shared header / drawer / footer wiring ---------- */

function markActiveNav() {
  const here = window.location.pathname.replace(/\/index\.html$/, '/') || '/';
  for (const link of $$('.nav-links a, .drawer a')) {
    const target = new URL(link.getAttribute('href'), window.location.origin).pathname;
    const normalised = target.replace(/\/index\.html$/, '/') || '/';
    if (normalised === here) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function wireDrawer() {
  const drawer = $('#drawer');
  const backdrop = $('#drawer-backdrop');
  const opener = $('#nav-toggle');
  if (!drawer || !backdrop || !opener) return;

  const setOpen = (open) => {
    drawer.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    opener.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) drawer.querySelector('a, button')?.focus();
  };

  opener.addEventListener('click', () => setOpen(!drawer.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  $('#drawer-close')?.addEventListener('click', () => setOpen(false));
  for (const link of drawer.querySelectorAll('a')) link.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer.classList.contains('open')) setOpen(false);
  });
}

function wireThemeButton() {
  const paint = () => {
    for (const button of $$('[data-theme-toggle]')) {
      button.replaceChildren(icon(resolved() === 'dark' ? ICONS.sun : ICONS.moon, { size: 20 }));
      button.setAttribute('aria-label', t('nav.theme', 'Toggle theme'));
    }
  };
  for (const button of $$('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      toggleTheme();
      paint();
    });
  }
  paint();
  return paint;
}

function wireLanguageSelects() {
  for (const select of $$('[data-lang-select]')) {
    select.replaceChildren(
      ...LANGUAGES.map((language) =>
        el('option', { value: language.code, text: language.label, selected: language.code === getLanguage() }),
      ),
    );
    select.value = getLanguage();
    select.addEventListener('change', () => setLanguage(select.value));
  }
}

/**
 * Boots the shared chrome. Every page calls this first and awaits it so no
 * untranslated text is ever painted.
 */
export async function initChrome() {
  initTheme();
  await initI18n();
  const repaintTheme = wireThemeButton();
  wireDrawer();
  wireLanguageSelects();
  markActiveNav();
  attachRipple();
  document.body.dataset.ready = 'true';

  window.addEventListener('languagechange', () => {});
  return { repaintTheme, applyTranslations };
}

export { applyTranslations, getLanguage, setLanguage, t };
