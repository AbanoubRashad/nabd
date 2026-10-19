import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Next.js 16 proxy (formerly middleware): resolves the locale prefix.
export default createMiddleware(routing);

export const config = {
  // Every path except API routes, Next internals and files (anything with a dot, like /images/x.jpg).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
