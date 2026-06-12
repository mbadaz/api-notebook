import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { CollectionEditor } from './components/CollectionEditor';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { PromptModal, type PromptConfig } from './components/PromptModal';
import { RequestEditor } from './components/RequestEditor';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { parseCurl } from './curl';
import type { Selection } from './selection';
import type { ApiRequest, WorkspaceMeta, WorkspaceTree } from './types';
import { VariablesContext, type VariablesInfo } from './variables';

const LAST_WORKSPACE_KEY = 'apinotebook.lastWorkspace';
const SIDEBAR_WIDTH_KEY = 'apinotebook.sidebarWidth';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 600;

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [prompt, setPrompt] = useState<PromptConfig | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ApiRequest | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const editorDirtyRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN
      ? Math.min(saved, SIDEBAR_MAX)
      : 280;
  });

  const workspaceId = tree?.meta.id ?? null;

  const showError = useCallback((err: unknown) => {
    setToast(err instanceof Error ? err.message : String(err));
  }, []);

  const loadTree = useCallback(
    async (id: string, keepSelection = false) => {
      try {
        const next = await api.getWorkspace(id);
        setTree(next);
        if (!keepSelection) setSelection(null);
        localStorage.setItem(LAST_WORKSPACE_KEY, id);
      } catch (err) {
        showError(err);
      }
    },
    [showError]
  );

  const handleDirtyChange = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
    setEditorDirty(dirty);
  }, []);

  /** True when it is OK to discard the current editor state. */
  function confirmDiscard(): boolean {
    return (
      !editorDirtyRef.current ||
      confirm('You have unsaved changes that will be lost. Continue?')
    );
  }

  function selectGuarded(sel: Selection) {
    if (!confirmDiscard()) return;
    handleDirtyChange(false);
    setSelection(sel);
  }

  useEffect(() => {
    if (!editorDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editorDirty]);

  const variablesInfo = useMemo<VariablesInfo>(() => {
    const activeEnv = tree?.environments.find(
      (e) => e.id === tree.activeEnvironmentId
    );
    const enabled = (activeEnv?.variables ?? []).filter(
      (v) => v.enabled && v.key
    );
    return {
      envName: activeEnv?.name ?? null,
      vars: Object.fromEntries(
        enabled
          // Secrets without a local value count as missing so their
          // tokens get the error highlight.
          .filter((v) => !(v.secret && v.value === ''))
          .map((v) => [v.key, v.value])
      ),
      definedNames: enabled.map((v) => v.key),
      secretNames: enabled.filter((v) => v.secret).map((v) => v.key),
      setVariable:
        tree && activeEnv
          ? async (name, value) => {
              const variables = activeEnv.variables.some((v) => v.key === name)
                ? activeEnv.variables.map((v) =>
                    v.key === name ? { ...v, value, enabled: true } : v
                  )
                : [
                    ...activeEnv.variables,
                    { key: name, value, enabled: true },
                  ];
              await api.updateEnvironment(tree.meta.id, activeEnv.id, {
                name: activeEnv.name,
                variables,
              });
              await loadTree(tree.meta.id, true);
            }
          : undefined,
    };
  }, [tree, loadTree]);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listWorkspaces();
        setWorkspaces(list);
        const last = localStorage.getItem(LAST_WORKSPACE_KEY);
        const initial =
          list.find((w) => w.id === last) ?? (list.length ? list[0] : null);
        if (initial) await loadTree(initial.id);
      } catch (err) {
        showError(err);
      } finally {
        setInitialized(true);
      }
    })();
  }, [loadTree, showError]);

  async function refreshWorkspaces() {
    setWorkspaces(await api.listWorkspaces());
  }

  function startSidebarResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    let width = startWidth;
    function onMove(ev: MouseEvent) {
      width = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX)
      );
      setSidebarWidth(width);
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function findRequest(
    collectionId: string,
    requestId: string
  ): ApiRequest | undefined {
    return tree?.collections
      .find((c) => c.id === collectionId)
      ?.requests.find((r) => r.id === requestId);
  }

  // ----- workspace prompts -----

  function promptNewWorkspace() {
    setPrompt({
      title: 'New Workspace',
      fields: [
        { name: 'name', label: 'Name', placeholder: 'My API Workspace' },
        {
          name: 'path',
          label: 'Workspace folder (you can create one in the dialog)',
          placeholder: '~/dev/my-api-workspace',
          type: 'folder',
        },
      ],
      onSubmit: async (values) => {
        const meta = await api.createWorkspace(values.name, values.path);
        await refreshWorkspaces();
        await loadTree(meta.id);
      },
    });
  }

  function promptOpenWorkspace() {
    setPrompt({
      title: 'Open Workspace Folder',
      submitLabel: 'Open',
      fields: [
        {
          name: 'path',
          label: 'Existing workspace folder',
          placeholder: '~/dev/shared-api-workspace',
          type: 'folder',
        },
      ],
      onSubmit: async (values) => {
        const meta = await api.openWorkspace(values.path);
        await refreshWorkspaces();
        await loadTree(meta.id);
      },
    });
  }

  // ----- collection / request / environment actions -----

  function promptNewCollection() {
    if (!workspaceId) return;
    setPrompt({
      title: 'New Collection',
      fields: [{ name: 'name', label: 'Name', placeholder: 'Users API' }],
      onSubmit: async (values) => {
        const collection = await api.createCollection(workspaceId, values.name);
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({ kind: 'collection', collectionId: collection.id });
        }
      },
    });
  }

  function promptNewRequest(collectionId: string) {
    if (!workspaceId) return;
    setPrompt({
      title: 'New Request',
      fields: [
        { name: 'name', label: 'Name', placeholder: 'Get user' },
        {
          name: 'type',
          label: 'Type',
          type: 'select',
          options: [
            { value: 'http', label: 'HTTP' },
            { value: 'graphql', label: 'GraphQL' },
          ],
        },
      ],
      onSubmit: async (values) => {
        const request = await api.createRequest(
          workspaceId,
          collectionId,
          values.name,
          values.type === 'graphql' ? 'graphql' : 'http'
        );
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({
            kind: 'request',
            collectionId,
            requestId: request.id,
          });
        }
      },
    });
  }

  function promptNewEnvironment() {
    if (!workspaceId) return;
    setPrompt({
      title: 'New Environment',
      fields: [{ name: 'name', label: 'Name', placeholder: 'dev' }],
      onSubmit: async (values) => {
        const env = await api.createEnvironment(workspaceId, values.name);
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({ kind: 'environment', environmentId: env.id });
        }
      },
    });
  }

  function promptRenameRequest(collectionId: string, requestId: string) {
    const request = findRequest(collectionId, requestId);
    if (!request || !workspaceId) return;
    setPrompt({
      title: 'Rename Request',
      submitLabel: 'Rename',
      fields: [{ name: 'name', label: 'Name', initial: request.name }],
      onSubmit: async (values) => {
        const name = values.name.trim();
        if (!name) throw new Error('Name is required');
        await api.updateRequest(workspaceId, collectionId, {
          ...request,
          name,
        });
        await loadTree(workspaceId, true);
      },
    });
  }

  function promptRenameCollection(collectionId: string) {
    const collection = tree?.collections.find((c) => c.id === collectionId);
    if (!collection || !workspaceId) return;
    setPrompt({
      title: 'Rename Collection',
      submitLabel: 'Rename',
      fields: [{ name: 'name', label: 'Name', initial: collection.name }],
      onSubmit: async (values) => {
        const name = values.name.trim();
        if (!name) throw new Error('Name is required');
        await api.updateCollection(workspaceId, collectionId, { name });
        await loadTree(workspaceId, true);
      },
    });
  }

  function promptImportCurl(collectionId: string) {
    if (!workspaceId) return;
    setPrompt({
      title: 'Import cURL',
      submitLabel: 'Import',
      fields: [
        {
          name: 'command',
          label: 'Paste a cURL command',
          type: 'textarea',
          placeholder:
            "curl 'https://api.example.com/users' -H 'Accept: application/json'",
        },
      ],
      onSubmit: async (values) => {
        const parsed = parseCurl(values.command);
        const created = await api.createRequest(
          workspaceId,
          collectionId,
          parsed.name,
          'http'
        );
        await api.updateRequest(workspaceId, collectionId, {
          ...parsed,
          id: created.id,
        });
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({
            kind: 'request',
            collectionId,
            requestId: created.id,
          });
        }
      },
    });
  }

  async function copyRequestInto(
    collectionId: string,
    source: ApiRequest,
    name: string
  ) {
    if (!workspaceId) return;
    try {
      const created = await api.createRequest(
        workspaceId,
        collectionId,
        name,
        source.type
      );
      await api.updateRequest(workspaceId, collectionId, {
        ...structuredClone(source),
        id: created.id,
        name,
      });
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  async function deleteRequestAction(collectionId: string, request: ApiRequest) {
    if (!workspaceId) return;
    if (!confirm(`Delete request "${request.name}"?`)) return;
    try {
      await api.deleteRequest(workspaceId, collectionId, request.id);
      setSelection((sel) =>
        sel?.kind === 'request' &&
        sel.collectionId === collectionId &&
        sel.requestId === request.id
          ? null
          : sel
      );
      handleDirtyChange(false);
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  async function deleteCollectionAction(collection: {
    id: string;
    name: string;
  }) {
    if (!workspaceId) return;
    if (
      !confirm(`Delete collection "${collection.name}" and all its requests?`)
    ) {
      return;
    }
    try {
      await api.deleteCollection(workspaceId, collection.id);
      setSelection((sel) =>
        (sel?.kind === 'collection' || sel?.kind === 'request') &&
        sel.collectionId === collection.id
          ? null
          : sel
      );
      handleDirtyChange(false);
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  async function selectEnvironment(environmentId: string | null) {
    if (!workspaceId) return;
    try {
      await api.setActiveEnvironment(workspaceId, environmentId);
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  function renderMain() {
    if (!initialized) return <div className="empty-state">Loading…</div>;

    if (!tree) {
      return (
        <div className="empty-state">
          <h1>API Notebook</h1>
          <p className="muted">
            A Git-friendly, file-based workspace for HTTP and GraphQL requests.
          </p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={promptNewWorkspace}>
              New Workspace
            </button>
            <button className="btn" onClick={promptOpenWorkspace}>
              Open Existing Folder
            </button>
          </div>
        </div>
      );
    }

    if (selection?.kind === 'request') {
      const collection = tree.collections.find(
        (c) => c.id === selection.collectionId
      );
      const request = collection?.requests.find(
        (r) => r.id === selection.requestId
      );
      if (collection && request) {
        return (
          <RequestEditor
            key={`${collection.id}/${request.id}`}
            workspaceId={tree.meta.id}
            collectionId={collection.id}
            request={request}
            onSaved={() => loadTree(tree.meta.id, true)}
            onDelete={() => deleteRequestAction(collection.id, request)}
            onDirtyChange={handleDirtyChange}
          />
        );
      }
    }

    if (selection?.kind === 'collection') {
      const collection = tree.collections.find(
        (c) => c.id === selection.collectionId
      );
      if (collection) {
        return (
          <CollectionEditor
            key={collection.id}
            collection={collection}
            onSave={async (changes) => {
              await api.updateCollection(tree.meta.id, collection.id, changes);
              await loadTree(tree.meta.id, true);
            }}
            onDelete={() => deleteCollectionAction(collection)}
            onDirtyChange={handleDirtyChange}
          />
        );
      }
    }

    if (selection?.kind === 'environment') {
      const environment = tree.environments.find(
        (e) => e.id === selection.environmentId
      );
      if (environment) {
        return (
          <EnvironmentEditor
            key={environment.id}
            environment={environment}
            isActive={tree.activeEnvironmentId === environment.id}
            onSave={async (changes) => {
              await api.updateEnvironment(
                tree.meta.id,
                environment.id,
                changes
              );
              await loadTree(tree.meta.id, true);
            }}
            onActivate={() => selectEnvironment(environment.id)}
            onDelete={async () => {
              if (!confirm(`Delete environment "${environment.name}"?`)) return;
              try {
                await api.deleteEnvironment(tree.meta.id, environment.id);
                setSelection(null);
                handleDirtyChange(false);
                await loadTree(tree.meta.id, true);
              } catch (err) {
                showError(err);
              }
            }}
            onDirtyChange={handleDirtyChange}
          />
        );
      }
    }

    return (
      <div className="empty-state">
        <p className="muted">
          Select a request from the sidebar, or create a collection to get
          started.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar
        workspaces={workspaces}
        currentWorkspaceId={workspaceId}
        onSelectWorkspace={(id) => {
          if (!confirmDiscard()) return;
          handleDirtyChange(false);
          void loadTree(id);
        }}
        onNewWorkspace={promptNewWorkspace}
        onOpenWorkspace={promptOpenWorkspace}
        environments={tree?.environments ?? []}
        activeEnvironmentId={tree?.activeEnvironmentId ?? null}
        onSelectEnvironment={selectEnvironment}
      />
      <VariablesContext.Provider value={variablesInfo}>
        <div className="app-body">
          {tree && (
            <>
              <Sidebar
                tree={tree}
                selection={selection}
                width={sidebarWidth}
                canPaste={clipboard !== null}
                requestActions={{
                  onRename: promptRenameRequest,
                  onCopy: (cid, rid) => {
                    const request = findRequest(cid, rid);
                    if (request) setClipboard(structuredClone(request));
                  },
                  onDuplicate: (cid, rid) => {
                    const request = findRequest(cid, rid);
                    if (request) {
                      void copyRequestInto(cid, request, `${request.name} copy`);
                    }
                  },
                  onDelete: (cid, rid) => {
                    const request = findRequest(cid, rid);
                    if (request) void deleteRequestAction(cid, request);
                  },
                }}
                collectionActions={{
                  onNewRequest: promptNewRequest,
                  onRename: promptRenameCollection,
                  onPasteRequest: (cid) => {
                    if (clipboard) {
                      void copyRequestInto(cid, clipboard, clipboard.name);
                    }
                  },
                  onImportCurl: promptImportCurl,
                  onDelete: (cid) => {
                    const collection = tree.collections.find(
                      (c) => c.id === cid
                    );
                    if (collection) void deleteCollectionAction(collection);
                  },
                }}
                onSelect={selectGuarded}
                onNewCollection={promptNewCollection}
                onNewEnvironment={promptNewEnvironment}
              />
              <div
                className="sidebar-resizer"
                title="Drag to resize the sidebar"
                onMouseDown={startSidebarResize}
              />
            </>
          )}
          <main className="main-pane">{renderMain()}</main>
        </div>
      </VariablesContext.Provider>
      {prompt && <PromptModal config={prompt} onClose={() => setPrompt(null)} />}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
