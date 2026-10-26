// HTTP API. Bound to 127.0.0.1 only; every mutating request must carry the
// X-Workspace header so other websites open in the browser cannot write to it.

import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Layer } from '../shared/types.ts';
import { getAssistant } from './ai/index.ts';
import {
  applyProposal,
  approveChapter,
  canonTargets,
  listProposals,
  previewProposal,
  rejectProposal,
  updateProposal,
} from './approvals.ts';
import {
  createChapter,
  discardRecovery,
  getChapter,
  listChapters,
  readApprovals,
  saveChapter,
  updateMeta,
  writeRecovery,
} from './chapters.ts';
import { readComments } from './commentStore.ts';
import { acceptSuggestion, confirmAnchor, createComment, reattachComment, replyToComment, updateComment } from './comments.ts';
import { exportManuscript } from './export.ts';
import { HttpError } from './fsutil.ts';
import type { Project } from './project.ts';
import { listReferenceFiles, readReferenceFile, search } from './reference.ts';
import { createVersion, listVersions, readVersionText, restoreVersion } from './versions.ts';

type Handler = (req: Request, res: Response) => Promise<unknown>;

const json = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((data) => {
    if (!res.headersSent) res.json(data ?? { ok: true });
  }, next);
};

const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp(project: Project, options: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));

  // Guard against DNS rebinding and cross-site requests.
  app.use((req, res, next) => {
    if (!ALLOWED_HOSTS.test(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Unrecognised host' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-workspace'] !== '1') {
      res.status(403).json({ error: 'Missing workspace header' });
      return;
    }
    next();
  });

  const r = express.Router();
  const p = (req: Request, name: string) => String(req.params[name]);

  r.get('/project', json(async () => project.info(getAssistant().available)));

  r.get('/chapters', json(() => listChapters(project)));
  r.post('/chapters', json((req) => createChapter(project, req.body ?? {})));
  r.get('/chapters/:id', json((req) => getChapter(project, p(req, 'id'))));
  r.put('/chapters/:id', json((req) => saveChapter(project, p(req, 'id'), req.body?.text, req.body?.baseHash)));
  r.patch('/chapters/:id/meta', json((req) => updateMeta(project, p(req, 'id'), req.body ?? {})));
  r.put('/chapters/:id/recovery', json((req) => writeRecovery(project, p(req, 'id'), req.body?.text)));
  r.post('/chapters/:id/recovery/discard', json((req) => discardRecovery(project, p(req, 'id'))));

  r.get('/chapters/:id/versions', json((req) => listVersions(project, p(req, 'id'))));
  r.get('/chapters/:id/text', json((req) => readVersionText(project, p(req, 'id'), req.query.ref)));
  r.post('/chapters/:id/versions', json((req) => createVersion(project, p(req, 'id'), req.body ?? {})));
  r.post('/chapters/:id/restore', json((req) => restoreVersion(project, p(req, 'id'), req.body ?? {})));

  r.get('/chapters/:id/comments', json((req) => readComments(project, p(req, 'id'))));
  r.post('/chapters/:id/comments', json((req) => createComment(project, p(req, 'id'), req.body ?? {})));
  r.patch('/chapters/:id/comments/:cid', json((req) => updateComment(project, p(req, 'id'), p(req, 'cid'), req.body ?? {})));
  r.post('/chapters/:id/comments/:cid/replies', json((req) => replyToComment(project, p(req, 'id'), p(req, 'cid'), req.body ?? {})));
  r.post('/chapters/:id/comments/:cid/confirm-anchor', json((req) => confirmAnchor(project, p(req, 'id'), p(req, 'cid'))));
  r.post('/chapters/:id/comments/:cid/reattach', json((req) => reattachComment(project, p(req, 'id'), p(req, 'cid'), req.body ?? {})));
  r.post('/chapters/:id/comments/:cid/accept-suggestion', json((req) => acceptSuggestion(project, p(req, 'id'), p(req, 'cid'), req.body ?? {})));

  r.get('/chapters/:id/approvals', json((req) => readApprovals(project, p(req, 'id'))));
  r.post('/chapters/:id/approve', json((req) => approveChapter(project, p(req, 'id'), req.body ?? {})));

  r.get('/proposals', json((req) => listProposals(project, typeof req.query.chapter === 'string' ? req.query.chapter : undefined)));
  r.get('/proposals/targets', json(() => canonTargets(project)));
  r.get('/proposals/:pid/preview', json((req) => previewProposal(project, p(req, 'pid'))));
  r.patch('/proposals/:pid', json((req) => updateProposal(project, p(req, 'pid'), req.body ?? {})));
  r.post('/proposals/:pid/reject', json((req) => rejectProposal(project, p(req, 'pid'))));
  r.post('/proposals/:pid/apply', json((req) => applyProposal(project, p(req, 'pid'), req.body ?? {})));

  r.get('/reference', json(() => listReferenceFiles(project)));
  r.get('/reference/file', json((req) => readReferenceFile(project, req.query.path)));
  r.get(
    '/search',
    json((req) => {
      const layers = typeof req.query.layers === 'string' && req.query.layers ? (req.query.layers.split(',') as Layer[]) : undefined;
      return search(project, req.query.q, layers);
    }),
  );

  r.get('/export', async (req, res, next) => {
    try {
      const which = req.query.which === 'approved' ? 'approved' : 'draft';
      const body = await exportManuscript(project, which);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="manuscript-${which}-${new Date().toISOString().slice(0, 10)}.md"`);
      res.send(body);
    } catch (e) {
      next(e);
    }
  });

  r.get('/ai/status', json(async () => ({ available: getAssistant().available, provider: getAssistant().name })));

  app.use('/api', r);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' });
  });

  return app;
}
