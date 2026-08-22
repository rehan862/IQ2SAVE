import { ApiError, api } from './api.js';
import { $, ICONS, el, formatBytes, icon, initChrome, t, toast } from './ui.js';
import { getPreference, setPreference } from './theme.js';
import { LANGUAGES, getLanguage, onLanguageChange, setLanguage } from './i18n.js';

const dom = {};
let system = null;

function kv(label, value) {
  return el('div', { class: 'kv' }, [el('dt', { text: label }), el('dd', { class: 'mono', text: value })]);
}

function renderTheme() {
  const options = [
    ['system', 'settings.theme.system', 'System'],
    ['light', 'settings.theme.light', 'Light'],
    ['dark', 'settings.theme.dark', 'Dark'],
  ];
  const active = getPreference();
  dom.theme.replaceChildren(
    ...options.map(([value, key, fallback]) =>
      el(
        'button',
        {
          class: `btn ${active === value ? 'btn-primary' : 'btn-outline'}`,
          type: 'button',
          'aria-pressed': String(active === value),
          onClick: () => {
            setPreference(value);
            renderTheme();
          },
        },
        [el('span', { text: t(key, fallback) })],
      ),
    ),
  );
}

function renderLanguage() {
  const active = getLanguage();
  dom.language.replaceChildren(
    ...LANGUAGES.map((language) =>
      el(
        'button',
        {
          class: `btn ${active === language.code ? 'btn-primary' : 'btn-outline'}`,
          type: 'button',
          'aria-pressed': String(active === language.code),
          onClick: () => setLanguage(language.code),
        },
        [el('span', { text: language.label })],
      ),
    ),
  );
}

function engineRow(name, info, installHint) {
  const ok = Boolean(info?.available);
  return el('div', { class: 'job-row' }, [
    el('div', { class: 'job-thumb' }, [icon(ok ? ICONS.check : ICONS.alert, { size: 18 })]),
    el('div', { class: 'job-main' }, [
      el('span', { class: 'job-title', text: name }),
      el('span', { class: 'job-sub' }, [
        el('span', {
          class: `badge ${ok ? 'badge-success' : 'badge-danger'}`,
          text: ok ? t('settings.engine.installed', 'Installed') : t('settings.engine.missing', 'Not found'),
        }),
        el('span', { class: 'mono', text: ok ? (info.version ?? '') : installHint }),
      ]),
    ]),
  ]);
}

function renderSystem() {
  if (!system) return;
  dom.engines.replaceChildren(
    engineRow('yt-dlp', system.capabilities.ytdlp, 'pkg install yt-dlp'),
    engineRow('ffmpeg', system.capabilities.ffmpeg, 'pkg install ffmpeg'),
  );

  dom.paths.replaceChildren(
    kv(t('settings.paths.downloads', 'Downloads'), system.paths.downloadDir),
    kv(t('library.stats.total', 'Downloads'), String(system.stats?.total ?? 0)),
    kv('Max file size', formatBytes(system.limits.maxFileBytes) ?? '—'),
    kv('Concurrent jobs', String(system.limits.maxConcurrentJobs)),
    kv('Active now', String(system.activeJobs ?? 0)),
  );
}

async function loadSystem() {
  try {
    system = await api.system();
    renderSystem();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : t('error.network', 'Network error.'), 'error');
  }
}

async function main() {
  await initChrome();
  dom.theme = $('#theme-options');
  dom.language = $('#language-options');
  dom.engines = $('#engine-list');
  dom.paths = $('#path-list');

  renderTheme();
  renderLanguage();
  onLanguageChange(() => {
    renderTheme();
    renderLanguage();
    renderSystem();
  });

  $('#refresh-system')?.addEventListener('click', loadSystem);
  await loadSystem();
}

main();
