import { EncryptedTokenStore, GoogleOAuth } from './google.oauth';
import { readGoogleConfig } from './google.config';
import { GoogleCalendarClient } from './google-calendar.client';
import { MeetTranscriptClient, readMeetCaptureConfig } from '../meeting-minutes/meet-transcript.client';
/** One OAuth/token source for Calendar and Meet, reusable in API and worker. No network at construction. */
export function createGoogleIntegration(env = process.env) {
  const config = readGoogleConfig(env);
  if (!config) return undefined;
  const store = new EncryptedTokenStore(config.tokenPath, config.encryptionKey);
  const oauth = new GoogleOAuth(config, store);
  const capture = readMeetCaptureConfig(env);
  // Calendar is usable with capture disabled; artefact capture remains disabled independently.
  const meetConfig = capture ?? { clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: '',
    policyVersion: '', notice: '', operators: new Set<string>() };
  return { config, oauth, capture, calendar: new GoogleCalendarClient(oauth, config.calendarId),
    meet: new MeetTranscriptClient(meetConfig, fetch, oauth) };
}
