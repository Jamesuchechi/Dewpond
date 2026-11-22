export { scanColumnSample, type PiiFinding } from '@dewpond/pii';

/** Redact ("Safe to share") is the locked v1 headline workflow per W0 Decision D4. */
export const REDACT_FEATURE_STATUS = 'v1-headline-planned' as const;
