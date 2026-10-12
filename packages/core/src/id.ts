// Note ids. Its own module (and the `./id` subpath) so the widget can mint
// ids without bundling the schema or the YAML code.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48-bit millisecond timestamp plus 80 random bits, Crockford base32. */
export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`ulid: timestamp out of range: ${String(now)}`);
  }
  let time = '';
  for (let rest = now, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) {
    time = CROCKFORD.charAt(rest % 32) + time;
  }
  // 256 is a multiple of 32, so masking each byte keeps the distribution uniform.
  const random = crypto.getRandomValues(new Uint8Array(16));
  return time + Array.from(random, (byte) => CROCKFORD.charAt(byte & 31)).join('');
}
