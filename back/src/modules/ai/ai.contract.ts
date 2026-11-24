/** Provider output stays unknown until the consumer validates evidence and schema. */
export type AiSegment = { id: string; text: string };
export type MinutesProposalInput = {
  segments: AiSegment[];
  // Deterministic official metadata is rendered by the server, not rewritten by the model.
  sourceKind: 'notes' | 'meet_transcript';
};
export interface AiClient {
  generateMinutes(input: MinutesProposalInput, signal: AbortSignal): Promise<unknown>;
  extractInsights(segment: string, signal: AbortSignal): Promise<unknown>;
}
export type AiConfigurationStatus = 'pending' | 'ready';
export type AiReviewStatus = {
  configuration: AiConfigurationStatus;
  reason?: string;
  source_outdated?: boolean;
};
