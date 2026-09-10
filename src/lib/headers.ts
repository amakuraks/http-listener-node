import type { IncomingHttpHeaders } from 'node:http';

/**
 * Node yields flat strings ("content-type": "application/json"); spec 4.1 and the
 * Laravel implementation use arrays ("content-type": ["application/json"]).
 * `set-cookie` already arrives as an array and passes through unchanged.
 */
export function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value : [value];
  }
  return out;
}
