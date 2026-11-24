import type { TranscriptRef } from '../meeting-transcripts/transcript.contract';
export function sameTranscriptRef(left: TranscriptRef, right: TranscriptRef) {
  return left.meetingId === right.meetingId && left.transcriptId === right.transcriptId &&
    left.version === right.version && left.contentHash === right.contentHash &&
    left.conferenceName === right.conferenceName && left.conferenceEndedAt === right.conferenceEndedAt &&
    left.policyVersion === right.policyVersion && left.providerTranscriptNames.length === right.providerTranscriptNames.length &&
    left.providerTranscriptNames.every((name, index) => name === right.providerTranscriptNames[index]);
}
