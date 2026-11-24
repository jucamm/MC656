import type { AiClient, AiSegment, MinutesProposalInput } from './ai.contract';
import { minimize, segments, SynthesisError } from '../legislative-compendia/compendium-synthesis';

export type Claim = { text: string; segmentId: string; quote: string };
const sections = ['summary', 'discussion', 'decisions', 'pending'] as const;
export type Proposal = Record<typeof sections[number], Claim[]>;
export function proposalSegments(entries: { id: string; text: string }[]): AiSegment[] {
  const result = entries.flatMap((entry, index) => segments(entry.text).map((text, part) => ({ id: 's' + index + 'p' + part, text })));
  if (!result.length || result.length > 256) throw new SynthesisError('AI_INPUT_LIMIT');
  return result;
}
export function validateProposal(raw: unknown, source: AiSegment[]): Proposal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== [...sections].sort().join()) throw new SynthesisError('AI_INVALID_OUTPUT');
  const output = {} as Proposal;
  for (const key of sections) {
    const claims: unknown = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(claims) || claims.length > 16) throw new SynthesisError('AI_INVALID_OUTPUT');
    output[key] = claims.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'quote,segmentId,text') throw new SynthesisError('AI_INVALID_OUTPUT');
      const item = value as Claim;
      const segment = source.find(entry => entry.id === item.segmentId);
      if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 || minimize(item.text) !== item.text ||
          typeof item.quote !== 'string' || item.quote.trim().length < 4 || item.quote.length > 350 ||
          !segment || !segment.text.includes(item.quote)) throw new SynthesisError('AI_UNSUPPORTED_EVIDENCE');
      return { text: item.text.trim(), segmentId: item.segmentId, quote: item.quote };
    });
  }
  return output;
}
/** Bounded extraction per part; final rendering combines only validated claims. */
export async function generateProposal(client: AiClient, input: MinutesProposalInput, signal: AbortSignal, allowed: () => Promise<boolean> = async () => true) {
  const batches: AiSegment[][] = [];
  let batch: AiSegment[] = [], size = 0;
  for (const segment of input.segments) {
    if (size + segment.text.length > 12_000 && batch.length) { batches.push(batch); batch = []; size = 0; }
    batch.push(segment); size += segment.text.length;
  }
  if (batch.length) batches.push(batch);
  if (!batches.length || batches.length > 16) throw new SynthesisError('AI_INPUT_LIMIT');
  const merged: Proposal = { summary: [], discussion: [], decisions: [], pending: [] };
  for (const part of batches) {
    signal.throwIfAborted();
    if (!await allowed()) throw new SynthesisError('SOURCE_CHANGED', true);
    const result = validateProposal(await client.generateMinutes({ ...input, segments: part }, signal), part);
    if (!await allowed()) throw new SynthesisError('SOURCE_CHANGED', true);
    for (const key of sections) merged[key].push(...result[key]);
  }
  // No silent truncation: large validated outputs require a smaller authorized source.
  const headings = { summary: 'Resumo', discussion: 'Discussão', decisions: 'Decisões explicitamente registradas', pending: 'Pendências' };
  const body = ['Proposta gerada por IA — requer revisão', ...sections.flatMap(key => [
    headings[key], ...(merged[key].length ? merged[key].map(item => '- ' + item.text) : ['Nenhum registro explícito.']),
  ])].join('\n\n');
  if (body.length > 28_000) throw new SynthesisError('AI_OUTPUT_LIMIT');
  return body;
}
