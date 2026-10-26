// Distraction-free reading view. Every rendered text segment carries its source
// offset (data-s), so a selection maps back to exact characters in the Markdown file.

import { memo, useEffect, useMemo, useRef } from 'react';
import { parseBlocks, segmentRuns, type Block, type HighlightRange } from '../../shared/text';

export interface ReaderSelection {
  start: number;
  end: number;
  x: number; // position of the selection relative to the scroll container's content
  y: number;
}

interface Props {
  text: string;
  highlights: HighlightRange[];
  activeId: string | null;
  jump: { offset: number; nonce: number } | null;
  onSelection: (sel: ReaderSelection | null) => void;
  onHighlightClick: (ids: string[]) => void;
}

function segmentStart(el: Element): number {
  return Number((el as HTMLElement).dataset.s);
}

/** Convert a DOM selection point to a source offset. */
function pointToOffset(node: Node, offset: number, root: HTMLElement): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const seg = node.parentElement?.closest('[data-s]');
    return seg ? segmentStart(seg) + offset : null;
  }
  const el = node as Element;
  if (el.matches?.('[data-s]')) return segmentStart(el) + (offset > 0 ? (el.textContent ?? '').length : 0);
  const child = el.childNodes[offset];
  if (child) {
    const seg = child.nodeType === Node.ELEMENT_NODE
      ? (child as Element).matches('[data-s]') ? (child as Element) : (child as Element).querySelector('[data-s]')
      : child.parentElement?.closest('[data-s]');
    if (seg) return segmentStart(seg);
  }
  // End of an element: use the end of its last segment, or the next one in the document.
  const segs = (el === root ? root : el).querySelectorAll('[data-s]');
  const last = segs[segs.length - 1];
  return last ? segmentStart(last) + (last.textContent ?? '').length : null;
}

const BlockView = memo(function BlockView({ block, highlights, activeId, first }: { block: Block; highlights: HighlightRange[]; activeId: string | null; first: boolean }) {
  if (block.kind === 'scene-break') return <div className="scene-break" aria-label="Scene break">* * *</div>;
  const segments = segmentRuns(block.runs, highlights);
  const children = segments.map((s) => {
    const cls = ['seg', s.italic && 'i', s.bold && 'b', s.ids.length > 0 && 'c', activeId && s.ids.includes(activeId) && 'active']
      .filter(Boolean)
      .join(' ');
    return (
      <span key={s.start} className={cls} data-s={s.start} data-c={s.ids.length ? s.ids.join(' ') : undefined}>
        {s.text}
      </span>
    );
  });
  const props = { 'data-bs': block.start, 'data-be': block.end };
  switch (block.kind) {
    case 'chapter-heading':
      return <h1 className="chapter-heading" {...props}>{children}</h1>;
    case 'heading':
      return block.level === 2 ? <h2 {...props}>{children}</h2> : <h3 {...props}>{children}</h3>;
    case 'quote':
      return <blockquote {...props}>{children}</blockquote>;
    default:
      return <p className={first ? 'first' : undefined} {...props}>{children}</p>;
  }
});

export function Reader({ text, highlights, activeId, jump, onSelection, onHighlightClick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => parseBlocks(text), [text]);

  const perBlock = useMemo(
    () => blocks.map((b) => highlights.filter((h) => h.start < b.end && h.end > b.start)),
    [blocks, highlights],
  );

  useEffect(() => {
    if (!jump || !root.current) return;
    const segs = [...root.current.querySelectorAll<HTMLElement>('[data-s]')];
    let target: HTMLElement | undefined;
    for (const s of segs) {
      if (segmentStart(s) <= jump.offset) target = s;
      else break;
    }
    target ??= segs[0];
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const block = target.closest('[data-bs]') as HTMLElement | null;
    if (block) {
      block.classList.remove('flash');
      void block.offsetWidth;
      block.classList.add('flash');
    }
  }, [jump]);

  const handleSelection = () => {
    const sel = window.getSelection();
    const el = root.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !el) {
      onSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      onSelection(null);
      return;
    }
    const a = pointToOffset(range.startContainer, range.startOffset, el);
    const b = pointToOffset(range.endContainer, range.endOffset, el);
    if (a === null || b === null) {
      onSelection(null);
      return;
    }
    let start = Math.min(a, b);
    let end = Math.max(a, b);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) {
      onSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const scroller = el.parentElement!;
    const box = scroller.getBoundingClientRect();
    onSelection({ start, end, x: rect.left + rect.width / 2 - box.left, y: rect.top - box.top + scroller.scrollTop - 8 });
  };

  return (
    <div
      ref={root}
      className="manuscript"
      onMouseUp={() => setTimeout(handleSelection, 0)}
      onKeyUp={(e) => e.shiftKey && handleSelection()}
      onClick={(e) => {
        const hit = (e.target as HTMLElement).closest('[data-c]') as HTMLElement | null;
        if (hit && window.getSelection()?.isCollapsed) onHighlightClick(hit.dataset.c!.split(' '));
      }}
    >
      {blocks.length === 0 && <p className="empty-chapter">This chapter is empty. Switch to Edit to begin writing.</p>}
      {blocks.map((b, i) => {
        const prev = blocks[i - 1];
        const first = !prev || prev.kind === 'scene-break' || prev.kind === 'chapter-heading' || prev.kind === 'heading';
        return <BlockView key={`${b.start}-${b.kind}`} block={b} highlights={perBlock[i]} activeId={activeId} first={first} />;
      })}
    </div>
  );
}
