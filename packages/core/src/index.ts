/** Version of the on-disk note format. Bumped only for breaking changes. */
export const SCHEMA_VERSION = 1;

const MAX_SLUG_LENGTH = 48;

/**
 * Turns free text into a filesystem-safe, human-readable slug used in note
 * directory names (`<id>-<slug>`). Always returns a non-empty string.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug || 'note';
}
