// Error monitoring. Off unless SENTRY_DSN is set, so development and the tests never send anything.
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NABD_RELEASE,
    serverName: 'ingest',
    tracesSampleRate: 0,
  });
}

export { Sentry };
