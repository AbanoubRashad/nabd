import { Logo } from '@/components/Logo';

// Phase 0 placeholder. The landing page (design v3) is built in Phase 7.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4">
      <div className="flex items-center gap-3">
        <Logo />
        <span className="font-display text-xl">
          Nabd <span lang="ar">نبض</span>
        </span>
      </div>
      <h1 className="font-display text-5xl leading-none sm:text-7xl">Every device has a pulse.</h1>
      <p className="max-w-xl text-lg text-ink-2">
        Real-time IoT monitoring for off-grid power, greenhouses, medicine fridges and cold rooms. This is the
        project scaffold; the site and dashboard are built phase by phase.
      </p>
    </main>
  );
}
