import { ApiError, api } from './api.js';
import {
  $,
  ICONS,
  el,
  formatBytes,
  formatDate,
  formatDuration,
  icon,
  initChrome,
  t,
  toast,
} from './ui.js';
import { onLanguageChange } from './i18n.js';

const state = { filter: null, jobs: [], counts: {} };
const dom = {};

const STATUS_BADGE = {
  completed: 'badge-success',
  failed: 'badge-danger',
  cancelled: 'badge-warn',
  running: 'badge-neutral',
  queued: 'badge-neutral',
};

const STATUS_LABEL = {
  completed: () => t('progress.completed', 'Done'),
  failed: () => t('progress.failed', 'Failed'),
  cancelled: () => t('progress.canceled', 'Canceled'),
  running: () => t('progress.running', 'Working'),
  queued: () => t('progress.queued', 'Queued'),
};

function statNode(value, labelKey, fallback) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-value', text: value }),
    el('span', { class: 'stat-label', text: t(labelKey, fallback) }),
  ]);
}

function renderStats() {
  const counts = state.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
  const bytes = state.jobs.reduce((sum, job) => sum + Number(job.outputBytes || 0), 0);
  dom.stats.replaceChildren(
    statNode(String(total), 'library.stats.total', 'Downloads'),
    statNode(String(counts.completed ?? 0), 'library.stats.completed', 'Completed'),
    statNode(String(counts.failed ?? 0), 'library.stats.failed', 'Failed'),
    statNode(formatBytes(bytes) ?? '0 B', 'library.stats.bytes', 'Total size'),
  );
}

function jobRow(job) {
  const sub = [
    job.formatLabel,
    formatBytes(job.outputBytes),
    formatDuration(job.duration),
    formatDate(job.createdAt),
  ]
    .filter(Boolean)
    .join(' · ');

  const thumb = el('div', { class: 'job-thumb' });
  if (job.thumbnail) {
    const img = el('img', { src: job.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => thumb.replaceChildren(icon(ICONS.file, { size: 18 })));
    thumb.append(img);
  } else {
    thumb.append(icon(job.container === 'mp3' ? ICONS.music : ICONS.film, { size: 18 }));
  }

  const actions = el('div', { class: 'job-actions' });
  if (job.status === 'completed' && job.hasFile) {
    actions.append(
      el(
        'a',
        { class: 'icon-btn', href: api.fileUrl(job.id), download: '', 'aria-label': t('progress.open', 'Open file') },
        [icon(ICONS.download, { size: 18 })],
      ),
    );
  }
  actions.append(
    el(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        'aria-label': t('library.delete', 'Remove entry'),
        onClick: () => removeJob(job.id),
      },
      [icon(ICONS.trash, { size: 18 })],
    ),
  );

  return el('div', { class: 'job-row' }, [
    thumb,
    el('div', { class: 'job-main' }, [
      el('span', { class: 'job-title', text: job.title || job.sourceUrl }),
      el('span', { class: 'job-sub' }, [
        el('span', { class: `badge ${STATUS_BADGE[job.status] ?? 'badge-neutral'}`, text: STATUS_LABEL[job.status]?.() ?? job.status }),
        sub ? el('span', { text: sub }) : null,
      ]),
      job.status === 'failed' && job.errorMessage ? el('span', { class: 'job-sub', text: job.errorMessage }) : null,
    ]),
    actions,
  ]);
}

function renderList() {
  if (state.jobs.length === 0) {
    dom.list.replaceChildren(
      el('div', { class: 'empty' }, [
        icon(ICONS.library, { size: 34 }),
        el('p', { text: t('library.empty', 'Nothing here yet.') }),
        el('a', { class: 'btn btn-outline', href: '/' }, [
          icon(ICONS.home, { size: 18 }),
          el('span', { text: t('library.emptyCta', 'Go to Home') }),
        ]),
      ]),
    );
    return;
  }
  dom.list.replaceChildren(...state.jobs.map(jobRow));
}

function renderFilters() {
  const options = [
    [null, 'library.filter.all', 'All'],
    ['completed', 'library.filter.completed', 'Completed'],
    ['failed', 'library.filter.failed', 'Failed'],
  ];
  dom.filters.replaceChildren(
    ...options.map(([value, key, fallback]) =>
      el(
        'button',
        {
          class: `btn ${state.filter === value ? 'btn-primary' : 'btn-ghost'}`,
          type: 'button',
          onClick: () => {
            state.filter = value;
            load();
          },
        },
        [el('span', { text: t(key, fallback) })],
      ),
    ),
  );
}

async function load() {
  renderFilters();
  try {
    const data = await api.jobs({ limit: 100, status: state.filter });
    state.jobs = data.jobs ?? [];
    state.counts = data.counts ?? {};
  } catch (error) {
    toast(error instanceof ApiError ? error.message : t('error.network', 'Network error.'), 'error');
    return;
  }
  renderStats();
  renderList();
}

async function removeJob(id) {
  try {
    await api.removeJob(id);
    toast(t('toast.removed', 'Entry removed'), 'success');
  } catch (error) {
    toast(error instanceof ApiError ? error.message : t('error.network', 'Network error.'), 'error');
  }
  load();
}

async function clearAll() {
  if (state.jobs.length === 0) return;
  if (!window.confirm(t('library.clearConfirm', 'Remove all history entries?'))) return;
  const ids = state.jobs.map((job) => job.id);
  await Promise.allSettled(ids.map((id) => api.removeJob(id)));
  toast(t('toast.cleared', 'History cleared'), 'success');
  load();
}

async function main() {
  await initChrome();
  dom.stats = $('#library-stats');
  dom.list = $('#library-list');
  dom.filters = $('#library-filters');

  $('#refresh-btn')?.addEventListener('click', load);
  $('#clear-btn')?.addEventListener('click', clearAll);
  onLanguageChange(() => {
    renderFilters();
    renderStats();
    renderList();
  });

  await load();
  // Anything still queued or running needs the list to keep up.
  setInterval(() => {
    if (state.jobs.some((job) => job.status === 'queued' || job.status === 'running')) load();
  }, 2000);
}

main();
