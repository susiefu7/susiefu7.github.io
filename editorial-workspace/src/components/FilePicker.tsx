// Choose a .md, .txt or .docx file and preview it as chapter Markdown. Saves nothing.

import { useState } from 'react';
import { api, type ConvertedFile } from '../api';
import { errorMessage, formatCount } from '../ui';

export interface PickedFile extends ConvertedFile {
  name: string;
}

export function FilePicker({ onPicked }: { onPicked: (file: PickedFile | null) => void }) {
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    setError(null);
    setPicked(null);
    onPicked(null);
    if (!file) return;
    setBusy(true);
    try {
      const converted = await api.convert(file.name, await file.arrayBuffer());
      const result = { ...converted, name: file.name };
      setPicked(result);
      onPicked(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        className="field"
        accept=".md,.markdown,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => choose(e.target.files?.[0])}
        aria-label="Choose a file"
      />
      {busy && <p className="hint">Reading the file…</p>}
      {error && <p className="anchor-flag">{error}</p>}
      {picked && (
        <div className="mt">
          <div className="hint">
            {picked.name} · {formatCount(picked.words)} words{picked.format === 'docx' ? ' · converted from Word' : ''}
          </div>
          {picked.warnings.map((w) => (
            <div key={w} className="anchor-flag">
              {w}
            </div>
          ))}
          <div className="preview mt" style={{ maxHeight: 180 }}>
            {picked.markdown.slice(0, 1200) || '(The file contains no text.)'}
            {picked.markdown.length > 1200 ? '…' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
