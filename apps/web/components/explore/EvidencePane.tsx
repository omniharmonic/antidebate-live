'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  const query = window.matchMedia('(min-width: 1280px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** A persistent inspector on wide screens; a focus-managed evidence sheet on phones. */
export function EvidencePane({ selected, onClose, children }: { selected: string | null; onClose: () => void; children: React.ReactNode }) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia('(min-width: 1280px)').matches, () => false);
  const [overview, setOverview] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = Boolean(selected) || overview;
  useEffect(() => {
    const el = dialog.current;
    if (!el || desktop) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open, desktop]);
  const close = () => { setOverview(false); onClose(); };
  if (desktop) return <aside className="evidence-pane scroll-quiet" aria-label="Evidence and conversation details">{children}</aside>;
  return (
    <div className="evidence-mobile">
      <button type="button" className="evidence-trigger" onClick={() => setOverview(true)} aria-haspopup="dialog">
        <span>{selected ? 'View selected proposition' : 'Conversation details'}</span><span aria-hidden>↗</span>
      </button>
      <dialog ref={dialog} className="evidence-sheet" aria-labelledby="evidence-title" onCancel={close} onClose={close} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="evidence-sheet-heading"><h2 id="evidence-title">{selected ? 'Evidence' : 'At this moment'}</h2><button type="button" className="control-button" onClick={close} autoFocus>Back to map</button></div>
        <div className="evidence-sheet-content scroll-quiet">{children}</div>
      </dialog>
    </div>
  );
}
