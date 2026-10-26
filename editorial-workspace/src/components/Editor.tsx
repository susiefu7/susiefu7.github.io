// Plain-text Markdown editor. A native textarea keeps 8,000-word chapters responsive
// and never reformats the author's text.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface EditorHandle {
  select: (start: number, end: number) => void;
  selection: () => { start: number; end: number };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange: (sel: { start: number; end: number }) => void;
  jump: { offset: number; nonce: number } | null;
}

const MIRRORED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'paddingTop', 'paddingLeft', 'paddingRight', 'tabSize', 'textIndent',
] as const;

/** Vertical pixel position of a character offset inside the textarea's content. */
function caretTop(ta: HTMLTextAreaElement, offset: number): number {
  const mirror = document.createElement('div');
  const cs = getComputedStyle(ta);
  for (const p of MIRRORED) mirror.style[p] = cs[p];
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-99999px',
    width: `${ta.clientWidth}px`, boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  });
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ value, onChange, onSelectionChange, jump }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);

  const select = (start: number, end: number) => {
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
    el.scrollTop = Math.max(0, caretTop(el, start) - el.clientHeight / 3);
    onSelectionChange({ start, end });
  };

  useImperativeHandle(ref, () => ({
    select,
    selection: () => ({ start: ta.current?.selectionStart ?? 0, end: ta.current?.selectionEnd ?? 0 }),
  }));

  useEffect(() => {
    if (jump) select(jump.offset, jump.offset);
  }, [jump]);

  const report = () => {
    const el = ta.current;
    if (el) onSelectionChange({ start: el.selectionStart, end: el.selectionEnd });
  };

  return (
    <div className="editor-wrap">
      <textarea
        ref={ta}
        className="editor"
        value={value}
        spellCheck
        lang="en-GB"
        aria-label="Chapter text (Markdown)"
        onChange={(e) => onChange(e.target.value)}
        onSelect={report}
        onKeyUp={report}
        onMouseUp={report}
      />
    </div>
  );
});
