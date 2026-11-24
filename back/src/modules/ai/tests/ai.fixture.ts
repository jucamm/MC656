import type { AiClient, MinutesProposalInput } from '../ai.contract';
/** Synthetic deterministic provider for tests only; never imported by application code. */
export const fixtureAi: AiClient = {
  async generateMinutes(input: MinutesProposalInput) {
    const first = input.segments[0];
    return { summary: [{ text: first.text.slice(0, 350), quote: first.text.slice(0, 350), segmentId: first.id }],
      discussion: [], decisions: [], pending: [] };
  },
  async extractInsights() { return { points: [] }; },
};
