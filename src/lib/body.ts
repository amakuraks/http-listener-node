export type BodyEncoding = 'utf8' | 'base64';

export interface EncodedBody {
  body: string;
  bodyEncoding: BodyEncoding;
  bodySize: number;
}

/**
 * Round-trips the buffer through UTF-8. If the bytes survive unchanged the payload is
 * text and is stored as-is; otherwise it is binary (PNG, gzip, protobuf) and is stored
 * base64 so nothing is lost. A naive .toString('utf8') would replace invalid sequences
 * with U+FFFD irreversibly.
 */
export function encodeBody(buf: Buffer): EncodedBody {
  if (buf.length === 0) return { body: '', bodyEncoding: 'utf8', bodySize: 0 };

  const asUtf8 = buf.toString('utf8');
  const isUtf8 = Buffer.compare(Buffer.from(asUtf8, 'utf8'), buf) === 0;

  return isUtf8
    ? { body: asUtf8, bodyEncoding: 'utf8', bodySize: buf.length }
    : { body: buf.toString('base64'), bodyEncoding: 'base64', bodySize: buf.length };
}

export function decodeBody(body: string, encoding: BodyEncoding): Buffer {
  return Buffer.from(body, encoding === 'base64' ? 'base64' : 'utf8');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Malformed JSON is a first-class use case for this tool, not an edge case - parse
 * failure must fall back to the raw text, never throw.
 */
export function prettyJson(body: string, contentType: string | undefined): string | null {
  if (!contentType?.toLowerCase().includes('json')) return null;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return null;
  }
}
