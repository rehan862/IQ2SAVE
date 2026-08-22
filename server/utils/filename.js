import path from 'node:path';

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Reduce arbitrary remote-supplied text (video titles, Content-Disposition
 * headers) to a single safe path segment. The output can never traverse
 * directories and never begins with a dash, which would otherwise be read as a
 * flag by the subprocesses we spawn.
 */
export function sanitizeFilename(input, { fallback = 'download', maxLength = 120 } = {}) {
  let name = typeof input === 'string' ? input : '';

  name = name
    .normalize('NFKD')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '') // control characters
    .replace(/[\\/]/g, '-') // path separators
    .replace(/[<>:"|?*]/g, '') // hostile on Windows, noisy everywhere
    .replace(/\s+/g, ' ')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();

  if (name.length > maxLength) name = name.slice(0, maxLength).trimEnd();
  if (!name || name === '.' || name === '..' || RESERVED_WINDOWS_NAMES.test(name)) name = fallback;
  return name;
}

/** Sanitize a name while preserving a known-good extension. */
export function sanitizeWithExtension(input, extension, options) {
  const ext = String(extension || '')
    .replace(/^\.+/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  const base = sanitizeFilename(input, options);
  return ext ? `${base}.${ext}` : base;
}

/** Add " (2)", " (3)"… until the name is free inside `dir`. */
export async function uniquePath(dir, filename, fsPromises) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  for (let i = 2; i < 1000; i += 1) {
    try {
      await fsPromises.access(path.join(dir, candidate));
    } catch {
      return path.join(dir, candidate);
    }
    candidate = `${base} (${i})${ext}`;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

/**
 * Guard against a computed path escaping its intended directory. Returns the
 * resolved path, or null when the input points outside `root`.
 */
export function containedPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, target);
  const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(withSep)) return null;
  return resolved;
}
