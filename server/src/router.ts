import { Router, type Request, type Response } from 'express';
import * as appData from './appData.js';
import { executeRequest } from './execute.js';
import { pickFolder } from './pickFolder.js';
import * as wsfs from './workspaceFs.js';
import { HttpError } from './workspaceFs.js';
import type { ApiRequest, WorkspaceMeta } from './types.js';

type Handler = (req: Request, res: Response) => void | Promise<void>;

const wrap =
  (fn: Handler) => (req: Request, res: Response, next: (e: unknown) => void) =>
    Promise.resolve(fn(req, res)).catch(next);

function getWorkspace(id: string): WorkspaceMeta {
  const entry = appData.findWorkspaceEntry(id);
  if (!entry) throw new HttpError(404, `Workspace "${id}" is not registered`);
  return wsfs.openWorkspace(entry.path);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `"${field}" is required`);
  }
  return value.trim();
}

export const router = Router();

router.post(
  '/pick-folder',
  wrap(async (req, res) => {
    const title =
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title
        : 'Choose a folder';
    res.json({ path: await pickFolder(title) });
  })
);

router.get(
  '/workspaces',
  wrap((_req, res) => {
    const workspaces: WorkspaceMeta[] = [];
    for (const entry of appData.listWorkspaceEntries()) {
      try {
        workspaces.push(wsfs.openWorkspace(entry.path));
      } catch {
        console.warn(`Skipping unreadable workspace at ${entry.path}`);
      }
    }
    res.json(workspaces);
  })
);

router.post(
  '/workspaces',
  wrap((req, res) => {
    const name = requireString(req.body.name, 'name');
    const dirPath = requireString(req.body.path, 'path');
    const meta = wsfs.createWorkspace(name, dirPath);
    appData.addWorkspaceEntry({ id: meta.id, path: meta.path });
    res.status(201).json(meta);
  })
);

router.post(
  '/workspaces/open',
  wrap((req, res) => {
    const dirPath = requireString(req.body.path, 'path');
    const meta = wsfs.openWorkspace(dirPath);
    appData.addWorkspaceEntry({ id: meta.id, path: meta.path });
    res.json(meta);
  })
);

router.get(
  '/workspaces/:id',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    res.json(wsfs.readTree(ws, appData.getActiveEnvironmentId(ws.id)));
  })
);

router.delete(
  '/workspaces/:id',
  wrap((req, res) => {
    appData.removeWorkspaceEntry(req.params.id);
    res.status(204).end();
  })
);

router.put(
  '/workspaces/:id/active-environment',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const envId: string | null = req.body.environmentId ?? null;
    if (envId !== null && !wsfs.getEnvironment(ws, envId)) {
      throw new HttpError(404, `Environment "${envId}" not found`);
    }
    appData.setActiveEnvironmentId(ws.id, envId);
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/collections',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    res.status(201).json(wsfs.createCollection(ws, name));
  })
);

router.patch(
  '/workspaces/:id/collections/:cid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateCollection(ws, req.params.cid, {
      name: req.body.name,
      description: req.body.description,
    });
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/collections/:cid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteCollection(ws, req.params.cid);
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/collections/:cid/requests',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    const type = req.body.type === 'graphql' ? 'graphql' : 'http';
    res.status(201).json(wsfs.createRequest(ws, req.params.cid, name, type));
  })
);

router.put(
  '/workspaces/:id/collections/:cid/requests/:rid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateRequest(
      ws,
      req.params.cid,
      req.params.rid,
      req.body as ApiRequest
    );
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/collections/:cid/requests/:rid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteRequest(ws, req.params.cid, req.params.rid);
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/environments',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    res.status(201).json(wsfs.createEnvironment(ws, name));
  })
);

router.put(
  '/workspaces/:id/environments/:eid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateEnvironment(ws, req.params.eid, {
      name: requireString(req.body.name, 'name'),
      variables: req.body.variables ?? [],
    });
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/environments/:eid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteEnvironment(ws, req.params.eid);
    if (appData.getActiveEnvironmentId(ws.id) === req.params.eid) {
      appData.setActiveEnvironmentId(ws.id, null);
    }
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/execute',
  wrap(async (req, res) => {
    const ws = getWorkspace(req.params.id);
    const request = req.body.request as ApiRequest;
    if (!request || typeof request.url !== 'string') {
      throw new HttpError(400, '"request" is required');
    }
    const activeId = appData.getActiveEnvironmentId(ws.id);
    const env = activeId ? wsfs.getEnvironment(ws, activeId) : undefined;
    res.json(await executeRequest(request, env));
  })
);
