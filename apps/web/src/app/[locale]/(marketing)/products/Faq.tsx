'use client';

import { useId, useState } from 'react';

/** Accordion: one answer open at a time, each a real button with aria-expanded and aria-controls. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  const id = useId();
  return (
    <div className="flex flex-col border-t border-line">
      {items.map((f, i) => {
        const expanded = i === open;
        return (
          <div key={f.q} className="border-b border-line">
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${id}-${i}`}
                onClick={() => setOpen(expanded ? -1 : i)}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent py-4 text-start text-[17px] font-semibold text-ink"
              >
                <span>{f.q}</span>
                <span aria-hidden="true" className="font-mono text-xl text-green-text">
                  {expanded ? '−' : '+'}
                </span>
              </button>
            </h3>
            <div id={`${id}-${i}`} hidden={!expanded}>
              <p className="max-w-[820px] pb-5 text-base leading-relaxed text-ink-2">{f.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
