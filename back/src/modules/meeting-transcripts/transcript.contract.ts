/** Internal authorized source contract. Never expose entries through a public minutes DTO. */
export type TranscriptState = 'pending' | 'processing' | 'available' | 'unavailable' | 'failed';
export type TranscriptEntry = { id: string; text: string; start_at: string; end_at: string };
export type TranscriptRef = {
  meetingId: string; transcriptId: string; version: number; contentHash: string;
  conferenceName: string; providerTranscriptNames: string[];
  conferenceEndedAt: string; policyVersion: string;
};
export type TranscriptSource = { ref: TranscriptRef; entries: TranscriptEntry[] };
export interface TranscriptSourceReader {
  describe(meetingId: string): Promise<{ state: TranscriptState; ref: TranscriptRef | null; failureCode: string | null }>;
  loadForGeneration(meetingId: string, expected: TranscriptRef, signal: AbortSignal): Promise<TranscriptSource>;
  isCurrent(expected: TranscriptRef): Promise<boolean>;
}
