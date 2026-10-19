import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Locale-aware Link and router: always use these instead of next/link inside the app. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
