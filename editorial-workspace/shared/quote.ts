// Finds a passage quoted by an editor (often an AI) in the chapter's Markdown source.
// Quotes rarely match byte for byte: emphasis markers are dropped, curly quotes become
// straight, spacing changes. Matching ignores those differences but still refuses to
// guess when a quote is missing or occurs more than once.

export type QuoteMatch =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: 'empty' | 'not-found' | 'ambiguous'; count: number };

const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '–': '-', '—': '-', '−': '-',
  ' ': ' ', '\t': ' ', '\n': ' ', '\r': ' ',
};

interface Normalised {
  text: string;
  map: number[]; // map[i] = index in the source of normalised character i
}

/** Normalise text, keeping a map back to source offsets. */
function normalise(source: string, caseless: boolean): Normalised {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '*' || c === '_') continue; // Markdown emphasis
    if (c === '…') {
      for (let k = 0; k < 3; k++) {
        text += '.';
        map.push(i);
      }
      continue;
    }
    let n = CHAR_MAP[c] ?? c;
    if (n === ' ' && text.endsWith(' ')) continue; // collapse runs of whitespace
    if (caseless) n = n.toLowerCase();
    text += n;
    map.push(i);
  }
  return { text, map };
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) out.push(i);
  return out;
}

function cleanQuote(quote: string, caseless: boolean): string {
  return normalise(quote, caseless).text.trim();
}

/** The quote as given, then without wrapping quotation marks an editor may have added. */
function variants(quote: string): string[] {
  const unwrapped = quote.replace(/^["']+|["']+$/g, '').trim();
  return unwrapped && unwrapped !== quote ? [quote, unwrapped] : [quote];
}

function locate(source: Normalised, quote: string): QuoteMatch {
  const hits = occurrences(source.text, quote);
  if (hits.length === 1) {
    const at = hits[0];
    return { ok: true, start: source.map[at], end: source.map[at + quote.length - 1] + 1 };
  }
  return { ok: false, reason: hits.length ? 'ambiguous' : 'not-found', count: hits.length };
}

export function findQuote(text: string, rawQuote: string): QuoteMatch {
  if (!cleanQuote(rawQuote, false).replace(/["']/g, '').trim()) return { ok: false, reason: 'empty', count: 0 };
  for (const caseless of [false, true]) {
    const source = normalise(text, caseless);
    const candidates = variants(cleanQuote(rawQuote, caseless));
    for (const candidate of candidates) {
      const direct = locate(source, candidate);
      if (direct.ok || direct.reason === 'ambiguous') return direct;
    }
    const quote = candidates[candidates.length - 1];

    // A long passage quoted as "opening words ... closing words".
    const parts = quote.split(/\s*\.\.\.\s*/).filter((p) => p.length >= 8);
    if (parts.length >= 2) {
      const first = locate(source, parts[0]);
      const lastPart = parts[parts.length - 1];
      if (first.ok) {
        const firstEnd = occurrences(source.text, parts[0])[0] + parts[0].length;
        const lastAt = source.text.indexOf(lastPart, firstEnd);
        if (lastAt !== -1 && lastAt - firstEnd < 6000) {
          return { ok: true, start: first.start, end: source.map[lastAt + lastPart.length - 1] + 1 };
        }
      }
    }
  }
  return { ok: false, reason: 'not-found', count: 0 };
}

export function describeMiss(match: QuoteMatch): string {
  if (match.ok) return '';
  if (match.reason === 'empty') return 'The quote is empty.';
  if (match.reason === 'ambiguous') return `Those words appear ${match.count} times in the chapter; quote a longer, unique passage.`;
  return 'Those words were not found in the chapter. Quote the passage exactly as it appears in the current draft.';
}
