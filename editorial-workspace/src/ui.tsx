// Small shared UI pieces.

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Layer } from '../shared/types';
import { LAYER_LABELS } from '../shared/types';

export type Notify = (message: string, kind?: 'info' | 'error') => void;
export const NotifyContext = createContext<Notify>(() => undefined);
export const useNotify = () => useContext(NotifyContext);

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function LayerBadge({ layer, short }: { layer: Layer; short?: boolean }) {
  const label = short ? SHORT_LABELS[layer] : LAYER_LABELS[layer];
  return (
    <span className={`badge ${layer}`} title={LAYER_LABELS[layer]}>
      {label}
    </span>
  );
}

const SHORT_LABELS: Record<Layer, string> = {
  canon: 'Canon',
  directive: 'Directive',
  idea: 'Idea · not canon',
  suggestion: 'Suggestion',
  draft: 'Draft',
  approved: 'Approved',
  superseded: 'Superseded',
  legacy: 'Legacy',
};

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 760 } : undefined}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-GB');
}

export const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  drafting: 'Drafting',
  revising: 'Revising',
  'in-review': 'In review',
};
