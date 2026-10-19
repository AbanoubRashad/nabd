import { defineRouting } from 'next-intl/routing';

/** English at the root, Arabic under /ar (right to left). */
export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
