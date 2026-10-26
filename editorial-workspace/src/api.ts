// Typed client for the workspace API.

import type {
  ApprovalRecord,
  CanonProposal,
  ChapterDocument,
  ChapterSummary,
  EditorialComment,
  Layer,
  NamedVersion,
  ProjectInfo,
  ReferenceFile,
  SearchResult,
  VersionEntry,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const binary = body instanceof ArrayBuffer;
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', 'X-Workspace': '1' },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export interface ConvertedFile {
  markdown: string;
  warnings: string[];
  format: 'markdown' | 'text' | 'docx';
  words: number;
}

export interface ImportReport {
  copied: string[];
  alreadyPresent: string[];
  conflicts: string[];
  notes: string[];
}

export const api = {
  project: () => request<ProjectInfo>('GET', '/project'),

  chapters: () => request<ChapterSummary[]>('GET', '/chapters'),
  chapter: (id: string) => request<ChapterDocument>('GET', `/chapters/${id}`),
  createChapter: (title: string, number?: number, text?: string, source?: string) =>
    request<ChapterDocument>('POST', '/chapters', { title, number, text, source }),
  /** Converts a .md/.txt/.docx file to chapter Markdown on the server. Nothing is saved. */
  convert: (name: string, bytes: ArrayBuffer) => request<ConvertedFile>('POST', `/convert?name=${enc(name)}`, bytes),
  save: (id: string, text: string, baseHash: string) => request<ChapterDocument>('PUT', `/chapters/${id}`, { text, baseHash }),
  updateMeta: (id: string, patch: { title?: string; status?: string }) => request<ChapterDocument>('PATCH', `/chapters/${id}/meta`, patch),
  writeRecovery: (id: string, text: string) => request<void>('PUT', `/chapters/${id}/recovery`, { text }),
  discardRecovery: (id: string) => request<void>('POST', `/chapters/${id}/recovery/discard`),

  versions: (id: string) => request<VersionEntry[]>('GET', `/chapters/${id}/versions`),
  versionText: (id: string, ref: string) => request<{ text: string; label: string }>('GET', `/chapters/${id}/text?ref=${enc(ref)}`),
  createVersion: (id: string, name: string, note: string) => request<NamedVersion>('POST', `/chapters/${id}/versions`, { name, note }),
  restore: (id: string, ref: string, baseHash: string) =>
    request<{ chapter: ChapterDocument; safetyVersion: NamedVersion }>('POST', `/chapters/${id}/restore`, { ref, baseHash }),

  comments: (id: string) => request<EditorialComment[]>('GET', `/chapters/${id}/comments`),
  createComment: (id: string, body: Record<string, unknown>) => request<EditorialComment>('POST', `/chapters/${id}/comments`, body),
  updateComment: (id: string, cid: string, patch: Record<string, unknown>) => request<EditorialComment>('PATCH', `/chapters/${id}/comments/${cid}`, patch),
  reply: (id: string, cid: string, body: string) => request<EditorialComment>('POST', `/chapters/${id}/comments/${cid}/replies`, { body, role: 'author' }),
  confirmAnchor: (id: string, cid: string) => request<EditorialComment>('POST', `/chapters/${id}/comments/${cid}/confirm-anchor`),
  reattach: (id: string, cid: string, start: number, end: number, baseHash: string) =>
    request<EditorialComment>('POST', `/chapters/${id}/comments/${cid}/reattach`, { start, end, baseHash }),
  acceptSuggestion: (id: string, cid: string, baseHash: string) =>
    request<{ chapter: ChapterDocument; comment: EditorialComment }>('POST', `/chapters/${id}/comments/${cid}/accept-suggestion`, { baseHash }),

  approvals: (id: string) => request<ApprovalRecord[]>('GET', `/chapters/${id}/approvals`),
  approve: (id: string, baseHash: string, note: string) =>
    request<{ approval: ApprovalRecord; proposals: CanonProposal[] }>('POST', `/chapters/${id}/approve`, { baseHash, note, confirm: true }),

  proposals: (chapterId?: string) => request<CanonProposal[]>('GET', `/proposals${chapterId ? `?chapter=${enc(chapterId)}` : ''}`),
  proposalTargets: () => request<string[]>('GET', '/proposals/targets'),
  previewProposal: (pid: string) =>
    request<{ proposal: CanonProposal; current: string | null; currentHash: string | null; exists: boolean }>('GET', `/proposals/${pid}/preview`),
  updateProposal: (pid: string, patch: { content?: string; targetFile?: string }) => request<CanonProposal>('PATCH', `/proposals/${pid}`, patch),
  rejectProposal: (pid: string) => request<CanonProposal>('POST', `/proposals/${pid}/reject`),
  applyProposal: (pid: string, expectedTargetHash: string | null) =>
    request<CanonProposal>('POST', `/proposals/${pid}/apply`, { confirm: true, expectedTargetHash }),

  referenceFiles: () => request<ReferenceFile[]>('GET', '/reference'),
  referenceFile: (path: string) =>
    request<{ path: string; layer: Layer; content: string; converted: boolean; warnings: string[] }>('GET', `/reference/file?path=${enc(path)}`),
  uploadReference: (layer: Layer, name: string, bytes: ArrayBuffer) =>
    request<ImportReport>('POST', `/reference/upload?layer=${enc(layer)}&name=${enc(name)}`, bytes),
  moveReference: (path: string, to: Layer) => request<{ path: string; layer: Layer }>('POST', '/reference/move', { path, to, confirm: true }),
  search: (q: string, layers?: Layer[]) => request<SearchResult>('GET', `/search?q=${enc(q)}${layers ? `&layers=${layers.join(',')}` : ''}`),
};
