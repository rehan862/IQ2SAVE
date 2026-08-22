import { ApiError, api } from './api.js';
import {
  $,
  ICONS,
  el,
  flashButton,
  formatBytes,
  formatDuration,
  formatSpeed,
  icon,
  initChrome,
  setBusy,
  t,
  toast,
} from './ui.js';
import { onLanguageChange } from './i18n.js';

const POLL_MS = 900;

const state = {
  url: '',
  media: null,
  provider: null,
  providerId: null,
  formatId: null,
  job: null,
  analyzeController: null,
  pollTimer: null,
};

const dom = {};

/* ---------- analyse ---------- */

function showSkeleton() {
  dom.result.replaceChildren(
    el('div', { class: 'card card-pad result' }, [
      el('div', { class: 'result-top' }, [
        el('div', { class: 'skeleton skeleton-thumb' }),
        el('div', { class: 'result-info' }, [
          el('div', { class: 'skeleton skeleton-line' }),
          el('div', { class: 'skeleton skeleton-line' }),
        ]),
      ]),
      el('ul', { class: 'loading-steps' }, [
        el('li', { class: 'active' }, [el('span', { class: 'tick' }), t('steps.one.title', 'Reading the link')]),
        el('li', {}, [el('span', { class: 'tick' }), t('result.formats', 'Available formats')]),
      ]),
    ]),
  );
  dom.result.hidden = false;
}

function setUrlError(message) {
  dom.hint.textContent = message ?? t('hero.hint', '');
  dom.hint.classList.toggle('error', Boolean(message));
  dom.input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

async function analyze(event) {
  event?.preventDefault();
  const url = dom.input.value.trim();
  if (!url) {
    setUrlError(t('error.emptyUrl', 'Paste a link first.'));
    dom.input.focus();
    return;
  }

  stopPolling();
  state.analyzeController?.abort();
  state.analyzeController = new AbortController();
  state.url = url;
  state.job = null;
  setUrlError(null);
  setBusy(dom.analyzeBtn, true, t('hero.analyzing', 'Analyzing…'));
  showSkeleton();

  try {
    const data = await api.analyze(url, state.analyzeController.signal);
    state.media = data.media;
    state.provider = data.providerLabel ?? data.provider;
    state.providerId = data.provider ?? data.media?.provider ?? null;
    state.formatId = data.media.formats?.[0]?.id ?? null;
    renderResult();
    dom.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    dom.result.hidden = true;
    dom.result.replaceChildren();
    const message = error instanceof ApiError ? error.message : t('error.network', 'Network error.');
    setUrlError(message);
    toast(message, 'error');
    flashButton(dom.analyzeBtn, 'is-error');
  } finally {
    setBusy(dom.analyzeBtn, false, t('hero.analyze', 'Analyze'));
  }
}

/* ---------- result card ---------- */

function thumbNode(media) {
  const wrap = el('div', { class: 'thumb' });
  const pretty = formatDuration(media.duration);
  const badge = pretty ? el('span', { class: 'duration-badge', text: pretty }) : null;
  const fallback = () => el('div', { class: 'thumb-fallback' }, [icon(ICONS.film, { size: 28 })]);

  if (media.thumbnail) {
    const img = el('img', { src: media.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => wrap.replaceChildren(fallback(), ...(badge ? [badge] : [])));
    wrap.append(img);
  } else {
    wrap.append(fallback());
  }
  if (badge) wrap.append(badge);
  return wrap;
}

function formatSubtitle(format) {
  const bits = [];
  if (format.container) bits.push(format.container.toUpperCase());
  if (format.fps) bits.push(`${Math.round(format.fps)} fps`);
  if (format.kind === 'audio') bits.push(t('result.audioOnly', 'Audio only'));
  if (format.requiresMerge) bits.push('merge');
  return bits.join(' · ');
}

function providerIcon(size = 17) {
  if (state.providerId === 'youtube') {
    return icon(ICONS.youtube, { size, fill: true, fillRule: 'evenodd' });
  }
  if (state.providerId === 'instagram') return icon(ICONS.instagram, { size });
  return icon(ICONS.film, { size });
}

function formatOption(format) {
  const size = formatBytes(format.approxBytes);
  const sizeText = size ? (format.exactSize ? size : `≈ ${size}`) : t('result.sizeUnknown', 'size unknown');

  const input = el('input', {
    type: 'radio',
    name: 'format',
    value: format.id,
    checked: format.id === state.formatId,
  });
  input.addEventListener('change', () => {
    state.formatId = format.id;
  });

  return el('label', { class: 'format-option' }, [
    input,
    el('span', { class: 'format-radio', 'aria-hidden': 'true' }),
    el('span', { class: 'format-icon' }, [
      format.kind === 'audio' ? icon(ICONS.music, { size: 17 }) : providerIcon(),
    ]),
    el('span', { class: 'format-main' }, [
      el('span', { class: 'format-name', text: format.label }),
      el('span', { class: 'format-sub', text: [formatSubtitle(format), format.note].filter(Boolean).join(' · ') }),
    ]),
    el('span', { class: 'format-size', text: sizeText }),
  ]);
}

function renderResult() {
  const media = state.media;
  if (!media) return;

  const meta = [];
  if (media.uploader) meta.push(media.uploader);
  const pretty = formatDuration(media.duration);
  if (pretty) meta.push(pretty);

  const badges = el('div', { class: 'result-meta' }, [
    el('span', { class: 'badge badge-neutral' }, [
      providerIcon(13),
      el('span', { text: media.providerLabel ?? state.provider ?? 'source' }),
    ]),
    media.live ? el('span', { class: 'badge badge-warn', text: 'LIVE' }) : null,
    ...meta.map((value) => el('span', { text: value })),
  ]);

  const formats = media.formats ?? [];

  dom.downloadBtn = el(
    'button',
    { class: 'btn btn-primary btn-lg btn-block', type: 'button', disabled: formats.length === 0 },
    [icon(ICONS.download, { size: 20 }), el('span', { text: t('result.download', 'Download') })],
  );
  dom.downloadBtn.addEventListener('click', startDownload);

  dom.progress = el('div', { class: 'progress-wrap', hidden: true });

  const card = el('div', { class: 'card card-pad result' }, [
    el('div', { class: 'result-top' }, [
      thumbNode(media),
      el('div', { class: 'result-info' }, [
        el('h3', { class: 'result-title', text: media.title || media.sourceUrl || state.url }),
        badges,
      ]),
    ]),
    ...(media.notices ?? []).map((notice) =>
      el('div', { class: `notice notice-${notice.level === 'warning' ? 'warning' : 'info'}` }, [
        icon(notice.level === 'warning' ? ICONS.alert : ICONS.info, { size: 17 }),
        el('span', { text: notice.message ?? String(notice) }),
      ]),
    ),
    el('div', { class: 'result-body' }, [
      formats.length
        ? el('div', { class: 'format-group' }, [
            el('span', { class: 'field-label', text: t('result.formats', 'Available formats') }),
            el('div', { class: 'format-list', role: 'radiogroup' }, formats.map(formatOption)),
          ])
        : el('div', { class: 'notice notice-warning' }, [
            icon(ICONS.alert, { size: 17 }),
            el('span', { text: t('result.noFormats', 'No downloadable format was found.') }),
          ]),
      dom.downloadBtn,
      dom.progress,
    ]),
  ]);

  dom.result.replaceChildren(card);
  dom.result.hidden = false;
}

/* ---------- download + polling ---------- */

async function startDownload() {
  if (!state.url) return;
  setBusy(dom.downloadBtn, true, t('result.downloading', 'Downloading…'));
  try {
    const data = await api.download(state.url, state.formatId ?? undefined);
    state.job = data.job;
    toast(t('toast.downloadStarted', 'Download started'), 'info');
    renderProgress();
    poll();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : t('error.network', 'Network error.');
    toast(message, 'error');
    flashButton(dom.downloadBtn, 'is-error');
    setBusy(dom.downloadBtn, false, t('result.download', 'Download'));
  }
}

const STAGE_LABEL = {
  queued: () => t('progress.queued', 'Queued'),
  downloading: () => t('progress.running', 'Working'),
  merging: () => t('progress.running', 'Working'),
  converting: () => t('progress.running', 'Working'),
  completed: () => t('progress.completed', 'Done'),
  failed: () => t('progress.failed', 'Failed'),
  cancelled: () => t('progress.canceled', 'Canceled'),
};

function stageText(job) {
  const key = job.status === 'running' ? job.stage || 'downloading' : job.status;
  const label = STAGE_LABEL[key]?.() ?? STAGE_LABEL[job.status]?.() ?? key;
  if (job.status === 'running' && job.stage && job.stage !== 'downloading') {
    return `${label} · ${job.stage}`;
  }
  return label;
}

function statsText(job) {
  const bits = [];
  const done = formatBytes(job.downloadedBytes);
  const total = formatBytes(job.totalBytes);
  if (done && total) bits.push(`${done} / ${total}`);
  else if (done) bits.push(done);
  else if (total) bits.push(total);
  const speed = formatSpeed(job.speedBps);
  if (speed) bits.push(speed);
  if (Number.isFinite(Number(job.etaSeconds)) && Number(job.etaSeconds) > 0) {
    bits.push(`${formatDuration(job.etaSeconds)} ${t('progress.eta', 'ETA')}`);
  }
  if (job.determinate && Number.isFinite(Number(job.progress))) {
    bits.unshift(`${Math.round(Number(job.progress) * 100)}%`);
  }
  return bits.join(' · ');
}

function renderProgress() {
  const job = state.job;
  if (!job || !dom.progress) return;

  const track = el('div', {
    class: `progress-track${job.determinate ? '' : ' indeterminate'}${job.status === 'completed' ? ' done' : ''}`,
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  });
  const bar = el('div', { class: 'progress-bar' });
  if (job.determinate && Number.isFinite(Number(job.progress))) {
    const pct = Math.max(0, Math.min(100, Number(job.progress) * 100));
    bar.style.width = `${pct}%`;
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
  } else {
    track.setAttribute('aria-valuetext', t('progress.unknownTotal', 'Total size unknown'));
  }
  track.append(bar);

  const children = [
    el('div', { class: 'progress-head' }, [
      el('span', { class: 'progress-stage', text: stageText(job) }),
      el('span', { class: 'progress-stats', text: statsText(job) }),
    ]),
    track,
  ];

  if (!job.determinate && (job.status === 'running' || job.status === 'queued')) {
    children.push(
      el('div', { class: 'notice notice-info' }, [
        icon(ICONS.info, { size: 17 }),
        el('span', { text: t('progress.unknownTotal', 'Total size unknown.') }),
      ]),
    );
  }

  if (job.status === 'queued' || job.status === 'running') {
    children.push(
      el(
        'button',
        {
          class: 'btn btn-ghost btn-block',
          type: 'button',
          onClick: cancelJob,
        },
        [icon(ICONS.cancel, { size: 18 }), el('span', { text: t('progress.cancel', 'Cancel') })],
      ),
    );
  }

  if (job.status === 'completed') {
    const size = formatBytes(job.outputBytes);
    children.push(
      el('div', { class: 'notice notice-info' }, [
        icon(ICONS.check, { size: 17 }),
        el('span', { text: `${t('progress.saved', 'Saved to')}: ${job.outputName ?? ''}${size ? ` (${size})` : ''}` }),
      ]),
      el('a', { class: 'btn btn-primary btn-block', href: api.fileUrl(job.id), download: '' }, [
        icon(ICONS.download, { size: 18 }),
        el('span', { text: t('progress.open', 'Open file') }),
      ]),
    );
  }

  if (job.status === 'failed') {
    children.push(
      el('div', { class: 'notice notice-warning' }, [
        icon(ICONS.alert, { size: 17 }),
        el('span', { text: job.errorMessage || t('error.title', 'Something went wrong') }),
      ]),
    );
  }

  dom.progress.replaceChildren(...children);
  dom.progress.hidden = false;
}

function stopPolling() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

/** Hand the finished file to the browser so it also lands in its Downloads folder. */
function saveToBrowser(job) {
  const link = el('a', { href: api.fileUrl(job.id), download: job.outputName || '', hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
}

async function poll() {
  if (!state.job) return;
  try {
    const data = await api.job(state.job.id);
    state.job = data.job;
  } catch (error) {
    stopPolling();
    setBusy(dom.downloadBtn, false, t('result.download', 'Download'));
    toast(error instanceof ApiError ? error.message : t('error.network', 'Network error.'), 'error');
    return;
  }

  renderProgress();

  const { status } = state.job;
  if (status === 'queued' || status === 'running') {
    state.pollTimer = setTimeout(poll, POLL_MS);
    return;
  }

  stopPolling();
  setBusy(dom.downloadBtn, false, t('result.download', 'Download'));
  if (status === 'completed') {
    flashButton(dom.downloadBtn, 'is-success');
    toast(t('toast.downloadDone', 'Download finished'), 'success');
    saveToBrowser(state.job);
  } else if (status === 'failed') {
    flashButton(dom.downloadBtn, 'is-error');
    toast(state.job.errorMessage || t('error.title', 'Something went wrong'), 'error');
  } else {
    toast(t('toast.canceled', 'Canceled'), 'info');
  }
}

async function cancelJob() {
  if (!state.job) return;
  stopPolling();
  try {
    await api.removeJob(state.job.id);
  } catch {
    /* the poll below reports the real state anyway */
  }
  try {
    const data = await api.job(state.job.id);
    state.job = data.job;
    renderProgress();
  } catch {
    dom.progress.hidden = true;
  }
  setBusy(dom.downloadBtn, false, t('result.download', 'Download'));
}

/* ---------- engine banner ---------- */

async function checkEngines() {
  try {
    const data = await api.system();
    const missing = [];
    if (!data.capabilities.ytdlp.available) missing.push('yt-dlp');
    if (!data.capabilities.ffmpeg.available) missing.push('ffmpeg');
    if (missing.length === 0) return;
    dom.engineBanner.replaceChildren(
      icon(ICONS.alert, { size: 18 }),
      el('span', { text: `Missing: ${missing.join(', ')} — run: pkg install ${missing.join(' ')}` }),
    );
    dom.engineBanner.hidden = false;
  } catch {
    /* the analyse call will surface any real connectivity problem */
  }
}

/* ---------- boot ---------- */

async function main() {
  await initChrome();

  dom.form = $('#url-form');
  dom.input = $('#url-input');
  dom.hint = $('#url-hint');
  dom.analyzeBtn = $('#analyze-btn');
  dom.clearBtn = $('#clear-btn');
  dom.result = $('#result-region');
  dom.engineBanner = $('#engine-banner');

  dom.form.addEventListener('submit', analyze);

  dom.input.addEventListener('input', () => {
    dom.clearBtn.classList.toggle('show', dom.input.value.length > 0);
    if (dom.input.getAttribute('aria-invalid') === 'true') setUrlError(null);
  });

  dom.clearBtn.addEventListener('click', () => {
    dom.input.value = '';
    dom.clearBtn.classList.remove('show');
    setUrlError(null);
    dom.input.focus();
  });

  $('#paste-btn')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) throw new Error('empty');
      dom.input.value = text.trim();
      dom.clearBtn.classList.add('show');
      toast(t('toast.pasted', 'Link pasted'), 'success');
    } catch {
      toast(t('toast.pasteFailed', 'Could not read the clipboard.'), 'error');
      dom.input.focus();
    }
  });

  onLanguageChange(() => {
    if (state.media) renderResult();
    if (state.job) renderProgress();
    if (dom.input.getAttribute('aria-invalid') !== 'true') setUrlError(null);
  });

  const shared = new URLSearchParams(window.location.search).get('url');
  if (shared) {
    dom.input.value = shared;
    dom.clearBtn.classList.add('show');
    analyze();
  }

  checkEngines();
}

main();
