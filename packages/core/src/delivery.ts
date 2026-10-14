/**
 * How long the widget keeps a delivered note (listed in "My notes"), and so
 * how long the local sink remembers the note's `clientId` to answer a resend.
 */
export const DELIVERED_RETENTION_MS: number = 7 * 24 * 60 * 60 * 1000;
