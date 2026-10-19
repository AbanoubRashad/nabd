// Browser error monitoring. Off unless NEXT_PUBLIC_SENTRY_DSN is set; the SDK is only loaded when it is.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import('@sentry/nextjs').then((Sentry) =>
    Sentry.init({ dsn, environment: process.env.NODE_ENV, tracesSampleRate: 0 }),
  );
}
