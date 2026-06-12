import type {
  ApiRequest,
  Collection,
  Environment,
  ExecutionResult,
  KeyValue,
  RequestType,
  WorkspaceMeta,
  WorkspaceTree,
} from './types';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const data =
    res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data as { error?: string } | null)?.error ??
        `${res.status} ${res.statusText}`
    );
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export const api = {
  pickFolder: (title: string) =>
    http<{ path: string | null }>('/api/pick-folder', json({ title })),

  pickFile: (title: string) =>
    http<{ path: string | null }>('/api/pick-file', json({ title })),

  listWorkspaces: () => http<WorkspaceMeta[]>('/api/workspaces'),

  createWorkspace: (name: string, path: string) =>
    http<WorkspaceMeta>('/api/workspaces', json({ name, path })),

  openWorkspace: (path: string) =>
    http<WorkspaceMeta>('/api/workspaces/open', json({ path })),

  removeWorkspace: (id: string) =>
    http<null>(`/api/workspaces/${id}`, { method: 'DELETE' }),

  getWorkspace: (id: string) => http<WorkspaceTree>(`/api/workspaces/${id}`),

  setActiveEnvironment: (id: string, environmentId: string | null) =>
    http<null>(`/api/workspaces/${id}/active-environment`, {
      method: 'PUT',
      body: JSON.stringify({ environmentId }),
      headers: { 'content-type': 'application/json' },
    }),

  createCollection: (id: string, name: string) =>
    http<Collection>(`/api/workspaces/${id}/collections`, json({ name })),

  updateCollection: (
    id: string,
    cid: string,
    changes: { name?: string; description?: string }
  ) =>
    http<null>(`/api/workspaces/${id}/collections/${cid}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
      headers: { 'content-type': 'application/json' },
    }),

  deleteCollection: (id: string, cid: string) =>
    http<null>(`/api/workspaces/${id}/collections/${cid}`, {
      method: 'DELETE',
    }),

  createRequest: (id: string, cid: string, name: string, type: RequestType) =>
    http<ApiRequest>(
      `/api/workspaces/${id}/collections/${cid}/requests`,
      json({ name, type })
    ),

  updateRequest: (id: string, cid: string, request: ApiRequest) =>
    http<null>(
      `/api/workspaces/${id}/collections/${cid}/requests/${request.id}`,
      {
        method: 'PUT',
        body: JSON.stringify(request),
        headers: { 'content-type': 'application/json' },
      }
    ),

  deleteRequest: (id: string, cid: string, rid: string) =>
    http<null>(`/api/workspaces/${id}/collections/${cid}/requests/${rid}`, {
      method: 'DELETE',
    }),

  createEnvironment: (id: string, name: string) =>
    http<Environment>(`/api/workspaces/${id}/environments`, json({ name })),

  updateEnvironment: (
    id: string,
    eid: string,
    changes: { name: string; variables: KeyValue[] }
  ) =>
    http<null>(`/api/workspaces/${id}/environments/${eid}`, {
      method: 'PUT',
      body: JSON.stringify(changes),
      headers: { 'content-type': 'application/json' },
    }),

  deleteEnvironment: (id: string, eid: string) =>
    http<null>(`/api/workspaces/${id}/environments/${eid}`, {
      method: 'DELETE',
    }),

  execute: (id: string, request: ApiRequest) =>
    http<ExecutionResult>(`/api/workspaces/${id}/execute`, json({ request })),
};
