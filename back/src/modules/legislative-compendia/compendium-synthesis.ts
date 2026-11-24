export const stances = ['for', 'against', 'unclassified'] as const;
type Stance = typeof stances[number];

export interface Insight {
  stance: Stance;
  argument: string;
  quote: string;
}

interface Reference {
  meeting_id: string;
  revision_id: string;
  quote: string;
}

export interface Topic {
  stance: Stance;
  argument: string;
  references: Reference[];
}

export class SynthesisError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly retryMs = 0) {
    super(code);
  }
}

export type ExtractInsights = (segment: string, signal: AbortSignal) => Promise<unknown>;

const segmentSize = 4_000;
const maxPoints = 8;
const maxArgument = 350;
const maxQuote = 350;
export const pipelineRevision = 'v1';

export function minimize(text: string) {
  return text
    .replace(/[\w.%+-]{1,128}@[\w.-]{1,255}\.[a-z]{2,24}/gi, '[e-mail omitido]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[link omitido]')
    .replace(/\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g, '[documento omitido]')
    .replace(/(?:\+55[ -]?)?(?:\(\d{2}\)|\b\d{2})[ -]?\d{4,5}[ -]?\d{4}\b/g, '[telefone omitido]');
}

export function segments(text: string) {
  const chars = Array.from(minimize(text));
  const result: string[] = [];
  for (let offset = 0; offset < chars.length;) {
    const limit = Math.min(offset + segmentSize, chars.length);
    let end = limit;
    if (limit < chars.length) {
      while (end > offset + segmentSize / 2 && chars[end - 1] !== '\n') end--;
      if (chars[end - 1] !== '\n') end = limit;
    }
    const segment = chars.slice(offset, end).join('').trim();
    if (segment) result.push(segment);
    offset = end;
  }
  // Um limite operacional acima do máximo previsto para uma ata. Nunca publica uma extração parcial.
  if (result.length > 17) throw new SynthesisError('SEGMENT_LIMIT');
  return result;
}

export function validateInsights(raw: unknown, segment: string): Insight[] {
  if (!raw || typeof raw !== 'object' || !('points' in raw) || Object.keys(raw).length !== 1 ||
      !Array.isArray(raw.points) || raw.points.length > maxPoints) throw new SynthesisError('INVALID_OUTPUT');
  return raw.points.map(point => {
    if (!point || typeof point !== 'object' || Object.keys(point).length !== 3 ||
        !stances.includes(point.stance) || typeof point.argument !== 'string' || !point.argument.trim() ||
        point.argument.length > maxArgument || typeof point.quote !== 'string' || point.quote.trim().length < 12 ||
        point.quote.length > maxQuote || !segment.includes(point.quote) ||
        minimize(point.argument) !== point.argument) throw new SynthesisError('UNSUPPORTED_OUTPUT');
    return { stance: point.stance, argument: point.argument.trim(), quote: point.quote };
  });
}

export function composeTopics(rows: { meeting_id: string; revision_id: string; points: Insight[] }[]) {
  const topics = new Map<string, Topic>();
  for (const { meeting_id, revision_id, points } of rows) {
    for (const point of points) {
      const key = point.stance + ':' + point.argument;
      const reference = { meeting_id, revision_id, quote: point.quote };
      const existing = topics.get(key);
      if (!existing) {
        topics.set(key, { stance: point.stance, argument: point.argument, references: [reference] });
      } else if (!existing.references.some(ref => ref.revision_id === revision_id && ref.quote === point.quote)) {
        existing.references.push(reference);
      }
    }
  }
  return [...topics.values()];
}
