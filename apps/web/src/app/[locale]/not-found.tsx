import { useTranslations } from 'next-intl';
import { Logo } from '@/components/Logo';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('header');
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-4 text-ink">
      <Logo className="size-12" />
      <h1 className="font-display text-5xl">404</h1>
      <p className="text-lg text-ink-2">This page has no pulse.</p>
      <div className="flex gap-4">
        <Link href="/">{t('home')}</Link>
        <Link href="/fleet">{t('demo')}</Link>
      </div>
    </main>
  );
}
