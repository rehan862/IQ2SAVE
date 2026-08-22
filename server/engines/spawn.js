import { spawn } from 'node:child_process';
import { ERRORS } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const MAX_CAPTURE_BYTES = 512 * 1024;
// `--dump-single-json` emits the whole metadata document as one line, and a
// YouTube video with 50 formats already exceeds 600 KB. This only has to stop a
// runaway process from exhausting a phone's memory.
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Feed a byte stream to a per-line callback, splitting on either terminator. */
function lineReader(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      // yt-dlp and ffmpeg rewrite progress with \r rather than \n, so both count
      // as terminators; otherwise progress would only arrive at exit.
      let index;
      while ((index = buffer.search(/[\r\n]/)) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line) onLine(line);
      }
      if (buffer.length > MAX_LINE_BYTES) {
        // Dropping is preferable to emitting a fragment: a truncated line would
        // reach the JSON parser looking like valid-but-corrupt output.
        logger.warn('Discarding oversized line from subprocess', { bytes: buffer.length });
        buffer = '';
      }
    },
    flush() {
      if (buffer) onLine(buffer);
      buffer = '';
    },
  };
}

/**
 * Run an external binary. Arguments are always passed as an array with no shell,
 * so user-supplied URLs cannot be interpreted as commands.
 */
export function runProcess(binary, args, options = {}) {
  const {
    signal,
    timeoutMs = 0,
    onStdoutLine,
    onStderrLine,
    cwd,
    capture = true,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      reject(ERRORS.PROCESSING_FAILED(`Could not start ${binary}.`, { cause }));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let cancelled = false;
    let timedOut = false;

    const stdoutReader = lineReader((line) => {
      if (capture && stdout.length < MAX_CAPTURE_BYTES) stdout += `${line}\n`;
      onStdoutLine?.(line);
    });
    const stderrReader = lineReader((line) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += `${line}\n`;
      onStderrLine?.(line);
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdoutReader.push(chunk));
    child.stderr.on('data', (chunk) => stderrReader.push(chunk));

    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      // ffmpeg and yt-dlp both flush on SIGTERM; escalate only if they hang.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5000).unref();
    };

    const onAbort = () => {
      cancelled = true;
      stop();
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (cause) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cause.code === 'ENOENT') {
        reject(ERRORS.ENGINE_MISSING(binary));
        return;
      }
      logger.error('Subprocess failed to run', { binary, code: cause.code });
      reject(ERRORS.PROCESSING_FAILED());
    });

    child.on('close', (code, sig) => {
      if (settled) return;
      settled = true;
      cleanup();
      stdoutReader.flush();
      stderrReader.flush();

      if (cancelled) {
        reject(ERRORS.CANCELLED());
        return;
      }
      if (timedOut) {
        reject(ERRORS.TIMEOUT());
        return;
      }
      resolve({ code: code ?? -1, signal: sig, stdout, stderr });
    });
  });
}

/** Resolve a binary's version string, or null when it is not runnable. */
export async function probeBinary(binary, args = ['--version']) {
  try {
    const { code, stdout } = await runProcess(binary, args, { timeoutMs: 15000 });
    if (code !== 0) return null;
    return stdout.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}
