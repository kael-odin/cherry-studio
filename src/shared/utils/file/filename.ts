/**
 * Filename validation + sanitization — pure-string utilities usable from both
 * main and renderer. Promoted from `src/main/utils/file/legacyFile.ts` per
 * the `v2-refactor-temp/docs/file-manager/utils-file-migration.md` Phase 1b.1
 * plan: this module is the SoT; `legacyFile.ts` re-exports for back-compat
 * during the consumer-migration window.
 *
 * Two layers, deliberately separated:
 *
 * - **Spec** — `isValidPosixFileName` / `isValidWindowsFileName`: can this name
 *   exist on that filesystem? Ask this about a path you ALREADY HAVE (a scanned
 *   file, a stored row, a cross-platform migration check). `@shared/utils/file/pathSpec`
 *   builds on these.
 * - **Convention** — `validateFileName`: should we let a user CREATE this name?
 *   Spec rules plus judgement calls, notably macOS's `:`, which is a Finder
 *   display convention and not a filesystem limit (`touch 'a:b.txt'` works).
 *
 * Conflating the two silently rejects real files: a macOS file honestly named
 * `a:b.txt` is legal on disk and must not fail a shape check just because the
 * UI would refuse to create it.
 *
 * Platform notes:
 * - Windows: rejects `< > : " / \ | ? *` and reserved names (CON / PRN /
 *   AUX / NUL / COM1-9 / LPT1-9), plus filenames ending in `.` or space.
 * - macOS: additionally rejects `:` — convention only, see above.
 * - Linux / other Unix: additionally rejects `/`.
 * - All platforms: rejects empty strings, lengths > 255, and embedded
 *   `NUL` (`\0`) characters.
 *
 * The legacy implementation lived in `legacyFile.ts:400` (validate) and
 * `legacyFile.ts:473` (sanitize); their behaviour is preserved verbatim.
 * `checkName` is intentionally NOT moved here because it logs through the
 * main-process `loggerService`; that helper stays in `legacyFile.ts` until a
 * shared logging surface lands.
 */

export type ValidateFileNameResult = { valid: true } | { valid: false; error: string }

/**
 * Filesystem limit, in UTF-16 code units.
 *
 * Deliberately imprecise and left as-is: Linux caps `NAME_MAX` at 255 **bytes**,
 * so 85 CJK characters already exceed it while `.length` reports 85. macOS and
 * Windows count UTF-16 units, where this is exact. Tightening it would reject
 * names that current code accepts, which needs its own assessment.
 */
const FILE_NAME_MAX_LENGTH = 255

/** Characters Windows forbids anywhere in a filename. Includes both separators. */
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/

/** Windows device names, reserved with or without an extension (`CON`, `COM1.txt`). */
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

/**
 * Whether a single path SEGMENT can exist on a POSIX filesystem.
 *
 * POSIX forbids exactly two things in a filename — `/` and `\0` — plus the
 * length cap. Everything else (`:`, `\`, `<`, trailing dots and spaces, `CON`)
 * is an ordinary character sequence. macOS and Linux agree here: the `:` rule in
 * `validateFileName` is a Finder display convention, not a filesystem rule, so
 * it lives there and not in this predicate.
 *
 * This is the SPEC half — "could this name exist on disk" — as opposed to the
 * CONVENTION half in `validateFileName`, which additionally refuses names that
 * are legal but a bad idea to create. Consumers validating an EXISTING path
 * (migration checks, path-shape schemas) want this one; UI validating a name a
 * user is about to type wants `validateFileName`.
 */
export function isValidPosixFileName(name: string): boolean {
  return name.length > 0 && name.length <= FILE_NAME_MAX_LENGTH && !name.includes('\0') && !name.includes('/')
}

/**
 * Whether a single path SEGMENT can exist on a Windows filesystem.
 *
 * Strictly narrower than {@link isValidPosixFileName}: Windows forbids
 * `< > : " / \ | ? *`, the reserved device names, and trailing `.` or space.
 * A name legal on POSIX is therefore often illegal here — which is exactly the
 * question a cross-platform migration has to ask before restoring a Linux
 * backup onto Windows.
 *
 * Spec half, same as above — no convention rules.
 */
export function isValidWindowsFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= FILE_NAME_MAX_LENGTH &&
    !name.includes('\0') &&
    !WINDOWS_INVALID_CHARS.test(name) &&
    !WINDOWS_RESERVED_NAMES.test(name) &&
    !name.endsWith('.') &&
    !name.endsWith(' ')
  )
}

/**
 * Validate a filename against the host platform's rules, for a name about to be
 * CREATED — spec rules plus conventions (see {@link isValidPosixFileName}).
 *
 * Pass an explicit `platform` to validate against a different OS than the
 * runtime — used by tests and by the migration path that has to honour the
 * source OS's filename conventions.
 *
 * Kept as its own control flow rather than delegating to the predicates above,
 * because each branch returns a distinct user-facing message; the predicates and
 * this function share the RULE definitions, not the checks.
 */
export function validateFileName(
  fileName: string,
  platform: NodeJS.Platform = process.platform
): ValidateFileNameResult {
  if (!fileName) {
    return { valid: false, error: 'File name cannot be empty' }
  }

  if (fileName.length === 0 || fileName.length > FILE_NAME_MAX_LENGTH) {
    return { valid: false, error: 'File name length must be between 1 and 255 characters' }
  }

  if (fileName.includes('\0')) {
    return { valid: false, error: 'File name cannot contain null characters.' }
  }

  if (platform === 'win32') {
    if (WINDOWS_INVALID_CHARS.test(fileName)) {
      return { valid: false, error: 'File name contains characters not supported by Windows: < > : " / \\ | ? *' }
    }
    if (WINDOWS_RESERVED_NAMES.test(fileName)) {
      return { valid: false, error: 'File name is a Windows reserved name.' }
    }
    if (fileName.endsWith('.') || fileName.endsWith(' ')) {
      return { valid: false, error: 'File name cannot end with a dot or a space' }
    }
  }

  if (platform !== 'win32') {
    if (fileName.includes('/')) {
      return { valid: false, error: 'File name cannot contain slashes /' }
    }
  }

  if (platform === 'darwin') {
    if (fileName.includes(':')) {
      return { valid: false, error: 'macOS filenames cannot contain a colon :' }
    }
  }

  return { valid: true }
}

/**
 * Replace forbidden characters in a filename so the result can be written on
 * any of Windows / macOS / Linux. Returns the empty string for empty input,
 * and `'untitled'` if every character was sanitised away.
 *
 * Steps (in order):
 * 1. Replace `< > : " / \ | ? *` and ASCII control chars (0x00-0x1f) with `replacement`.
 * 2. Replace Windows-reserved prefixes (CON / PRN / AUX / NUL / COM1-9 /
 *    LPT1-9) — preserves the trailing `.<ext>` or end-of-string.
 * 3. Trim trailing whitespace and dots (Windows convention).
 * 4. Truncate to 255 characters (filesystem limit).
 */
export function sanitizeFilename(fileName: string, replacement = '_'): string {
  if (!fileName) return ''

  let sanitized = fileName
    // Not `WINDOWS_INVALID_CHARS`: this one also strips ASCII control characters
    // and is global.
    // oxlint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement)
    .replace(WINDOWS_RESERVED_NAMES, `${replacement}$2`)
    .replace(/[\s.]+$/, '')
    .substring(0, FILE_NAME_MAX_LENGTH)

  if (!sanitized) {
    sanitized = 'untitled'
  }

  return sanitized
}
