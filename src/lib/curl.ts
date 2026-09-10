/**
 * POSIX single-quote escaping: close the quote, emit an escaped quote, reopen.
 *
 *   it's fine   ->   'it'\''s fine'
 *
 * Written with String.raw so the sequence is literal and cannot be mangled by an
 * extra layer of backslash processing. Getting this wrong is not cosmetic: emitting
 * ''' instead of '\'' makes the shell DELETE the apostrophe, silently producing a
 * curl command that sends different data than was captured.
 */
const ESCAPED_QUOTE = String.raw`'\''`;

/** Backslash + newline: shell line continuation, so the command stays readable. */
const LINE_CONTINUATION = ' \\\n';

function shellQuote(value: string): string {
  return `'${value.split("'").join(ESCAPED_QUOTE)}'`;
}

export interface CurlInput {
  method: string;
  url: string;
  headers: Record<string, string[]>;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  baseUrl: string;
}

// curl regenerates these; echoing captured values back breaks the command elsewhere.
const SKIPPED_HEADERS = new Set(['host', 'content-length', 'connection']);

export function toCurl(input: CurlInput): string {
  const parts = [`curl -X ${input.method}`];

  for (const [name, values] of Object.entries(input.headers)) {
    if (SKIPPED_HEADERS.has(name.toLowerCase())) continue;
    for (const value of values) {
      parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
    }
  }

  if (input.body !== '') {
    parts.push(
      input.bodyEncoding === 'base64'
        ? '  --data-binary @body.bin  # binary body: save it from the raw endpoint first'
        : `  --data-binary ${shellQuote(input.body)}`,
    );
  }

  parts.push(`  ${shellQuote(input.baseUrl + input.url)}`);
  return parts.join(LINE_CONTINUATION);
}
