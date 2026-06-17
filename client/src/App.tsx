import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { NodeEditor } from './components/NodeEditor';
import { CookieManager } from './components/CookieManager';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { PromptModal, type PromptConfig } from './components/PromptModal';
import { RequestEditor } from './components/RequestEditor';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { parseCurl } from './curl';
import type { Selection } from './selection';
import type {
  ApiRequest,
  Collection,
  Folder,
  WorkspaceMeta,
  WorkspaceTree,
} from './types';
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
  const [showCookies, setShowCookies] = useState(false);
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

  function findCollection(collectionId: string): Collection | undefined {
    return tree?.collections.find((c) => c.id === collectionId);
  }

  /** The container at a folder path — the collection itself when path is []. */
  function findNode(
    collectionId: string,
    folderPath: string[]
  ): { folders: Folder[]; requests: ApiRequest[] } | undefined {
    let node: { folders: Folder[]; requests: ApiRequest[] } | undefined =
      findCollection(collectionId);
    for (const slug of folderPath) {
      node = node?.folders.find((f) => f.id === slug);
      if (!node) return undefined;
    }
    return node;
  }

  function findFolder(
    collectionId: string,
    folderPath: string[]
  ): Folder | undefined {
    if (folderPath.length === 0) return undefined;
    return findNode(collectionId, folderPath) as Folder | undefined;
  }

  function findRequest(
    collectionId: string,
    folderPath: string[],
    requestId: string
  ): ApiRequest | undefined {
    return findNode(collectionId, folderPath)?.requests.find(
      (r) => r.id === requestId
    );
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

  function promptNewRequest(collectionId: string, folderPath: string[]) {
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
          folderPath,
          values.name,
          values.type === 'graphql' ? 'graphql' : 'http'
        );
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({
            kind: 'request',
            collectionId,
            folderPath,
            requestId: request.id,
          });
        }
      },
    });
  }

  function promptNewFolder(collectionId: string, parentPath: string[]) {
    if (!workspaceId) return;
    setPrompt({
      title: 'New Folder',
      fields: [{ name: 'name', label: 'Name', placeholder: 'Admin' }],
      onSubmit: async (values) => {
        const folder = await api.createFolder(
          workspaceId,
          collectionId,
          parentPath,
          values.name
        );
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({
            kind: 'folder',
            collectionId,
            folderPath: [...parentPath, folder.id],
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

  function promptRenameRequest(
    collectionId: string,
    folderPath: string[],
    requestId: string
  ) {
    const request = findRequest(collectionId, folderPath, requestId);
    if (!request || !workspaceId) return;
    setPrompt({
      title: 'Rename Request',
      submitLabel: 'Rename',
      fields: [{ name: 'name', label: 'Name', initial: request.name }],
      onSubmit: async (values) => {
        const name = values.name.trim();
        if (!name) throw new Error('Name is required');
        await api.updateRequest(workspaceId, collectionId, folderPath, {
          ...request,
          name,
        });
        await loadTree(workspaceId, true);
      },
    });
  }

  /** Renames a collection (folderPath []) or a folder. */
  function promptRenameNode(collectionId: string, folderPath: string[]) {
    if (!workspaceId) return;
    const isFolder = folderPath.length > 0;
    const node = isFolder
      ? findFolder(collectionId, folderPath)
      : findCollection(collectionId);
    if (!node) return;
    setPrompt({
      title: isFolder ? 'Rename Folder' : 'Rename Collection',
      submitLabel: 'Rename',
      fields: [{ name: 'name', label: 'Name', initial: node.name }],
      onSubmit: async (values) => {
        const name = values.name.trim();
        if (!name) throw new Error('Name is required');
        if (isFolder) {
          await api.updateFolder(workspaceId, collectionId, folderPath, { name });
        } else {
          await api.updateCollection(workspaceId, collectionId, { name });
        }
        await loadTree(workspaceId, true);
      },
    });
  }

  function promptImportCurl(collectionId: string, folderPath: string[]) {
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
          folderPath,
          parsed.name,
          'http'
        );
        await api.updateRequest(workspaceId, collectionId, folderPath, {
          ...parsed,
          id: created.id,
        });
        await loadTree(workspaceId, true);
        if (!editorDirtyRef.current) {
          setSelection({
            kind: 'request',
            collectionId,
            folderPath,
            requestId: created.id,
          });
        }
      },
    });
  }

  async function importPostman() {
    if (!workspaceId) return;
    try {
      const picked = await api.pickFile(
        'Choose a Postman collection or environment export'
      );
      if (!picked.path) return;
      const result = await api.importPostman(workspaceId, picked.path);
      await loadTree(workspaceId, true);
      setToast(
        result.kind === 'collection'
          ? `Imported ${result.requests} request${
              result.requests === 1 ? '' : 's'
            }${
              result.folders
                ? ` across ${result.folders} folder${result.folders === 1 ? '' : 's'}`
                : ''
            }.`
          : `Imported environment "${result.name}" with ${result.variables} variable${
              result.variables === 1 ? '' : 's'
            }.`
      );
    } catch (err) {
      showError(err);
    }
  }

  async function copyRequestInto(
    collectionId: string,
    folderPath: string[],
    source: ApiRequest,
    name: string
  ) {
    if (!workspaceId) return;
    try {
      const created = await api.createRequest(
        workspaceId,
        collectionId,
        folderPath,
        name,
        source.type
      );
      await api.updateRequest(workspaceId, collectionId, folderPath, {
        ...structuredClone(source),
        id: created.id,
        name,
      });
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  async function deleteRequestAction(
    collectionId: string,
    folderPath: string[],
    request: ApiRequest
  ) {
    if (!workspaceId) return;
    if (!confirm(`Delete request "${request.name}"?`)) return;
    try {
      await api.deleteRequest(workspaceId, collectionId, folderPath, request.id);
      setSelection((sel) =>
        sel?.kind === 'request' &&
        sel.collectionId === collectionId &&
        sel.requestId === request.id &&
        sel.folderPath.join('/') === folderPath.join('/')
          ? null
          : sel
      );
      handleDirtyChange(false);
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  /** Deletes a collection (folderPath []) or a folder, with its contents. */
  async function deleteNode(collectionId: string, folderPath: string[]) {
    if (!workspaceId) return;
    const isFolder = folderPath.length > 0;
    const node = isFolder
      ? findFolder(collectionId, folderPath)
      : findCollection(collectionId);
    if (!node) return;
    const label = isFolder ? 'folder' : 'collection';
    if (!confirm(`Delete ${label} "${node.name}" and everything inside it?`)) {
      return;
    }
    try {
      if (isFolder) {
        await api.deleteFolder(workspaceId, collectionId, folderPath);
      } else {
        await api.deleteCollection(workspaceId, collectionId);
      }
      // Clear the selection if it pointed inside the deleted node.
      setSelection((sel) => {
        if (!sel || sel.kind === 'environment') return sel;
        if (sel.collectionId !== collectionId) return sel;
        const selPath =
          sel.kind === 'collection' ? [] : sel.folderPath;
        const prefix = folderPath.join('/');
        const within =
          selPath.join('/') === prefix ||
          selPath.join('/').startsWith(prefix + '/') ||
          (!isFolder);
        return within ? null : sel;
      });
      handleDirtyChange(false);
      await loadTree(workspaceId, true);
    } catch (err) {
      showError(err);
    }
  }

  async function moveRequestAction(
    from: { collectionId: string; folderPath: string[]; requestId: string },
    to: { collectionId: string; folderPath: string[] }
  ) {
    if (!workspaceId) return;
    try {
      const result = await api.moveRequest(workspaceId, from, to);
      await loadTree(workspaceId, true);
      setSelection((sel) =>
        sel?.kind === 'request' &&
        sel.collectionId === from.collectionId &&
        sel.requestId === from.requestId &&
        sel.folderPath.join('/') === from.folderPath.join('/')
          ? {
              kind: 'request',
              collectionId: result.collectionId,
              folderPath: result.folderPath,
              requestId: result.requestId,
            }
          : sel
      );
    } catch (err) {
      showError(err);
    }
  }

  async function moveFolderAction(
    from: { collectionId: string; folderPath: string[] },
    to: { collectionId: string; folderPath: string[] }
  ) {
    if (!workspaceId) return;
    try {
      const result = await api.moveFolder(workspaceId, from, to);
      await loadTree(workspaceId, true);
      // Remap a selection that pointed inside the moved subtree to its new path.
      setSelection((sel) => {
        if (!sel || sel.kind === 'environment' || sel.kind === 'collection') {
          return sel;
        }
        if (sel.collectionId !== from.collectionId) return sel;
        const fromKey = from.folderPath.join('/');
        const selKey = sel.folderPath.join('/');
        if (selKey !== fromKey && !selKey.startsWith(fromKey + '/')) return sel;
        const suffix = sel.folderPath.slice(from.folderPath.length);
        return {
          ...sel,
          collectionId: result.collectionId,
          folderPath: [...result.folderPath, ...suffix],
        };
      });
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
      const { collectionId, folderPath, requestId } = selection;
      const collection = findCollection(collectionId);
      const request = findRequest(collectionId, folderPath, requestId);
      if (collection && request) {
        return (
          <RequestEditor
            key={`${collectionId}/${folderPath.join('/')}/${request.id}`}
            workspaceId={tree.meta.id}
            collectionId={collectionId}
            folderPath={folderPath}
            request={request}
            onSaved={() => loadTree(tree.meta.id, true)}
            onDelete={() =>
              deleteRequestAction(collectionId, folderPath, request)
            }
            onDirtyChange={handleDirtyChange}
            onVariablesChanged={() => loadTree(tree.meta.id, true)}
          />
        );
      }
    }

    if (selection?.kind === 'collection') {
      const collection = findCollection(selection.collectionId);
      if (collection) {
        return (
          <NodeEditor
            key={collection.id}
            kind="collection"
            node={collection}
            onSave={async (changes) => {
              await api.updateCollection(tree.meta.id, collection.id, changes);
              await loadTree(tree.meta.id, true);
            }}
            onDelete={() => deleteNode(collection.id, [])}
            onDirtyChange={handleDirtyChange}
          />
        );
      }
    }

    if (selection?.kind === 'folder') {
      const { collectionId, folderPath } = selection;
      const folder = findFolder(collectionId, folderPath);
      if (folder) {
        return (
          <NodeEditor
            key={`${collectionId}/${folderPath.join('/')}`}
            kind="folder"
            node={folder}
            onSave={async (changes) => {
              await api.updateFolder(
                tree.meta.id,
                collectionId,
                folderPath,
                changes
              );
              await loadTree(tree.meta.id, true);
            }}
            onDelete={() => deleteNode(collectionId, folderPath)}
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
        onShowCookies={() => setShowCookies(true)}
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
                  onCopy: (cid, fp, rid) => {
                    const request = findRequest(cid, fp, rid);
                    if (request) setClipboard(structuredClone(request));
                  },
                  onDuplicate: (cid, fp, rid) => {
                    const request = findRequest(cid, fp, rid);
                    if (request) {
                      void copyRequestInto(cid, fp, request, `${request.name} copy`);
                    }
                  },
                  onDelete: (cid, fp, rid) => {
                    const request = findRequest(cid, fp, rid);
                    if (request) void deleteRequestAction(cid, fp, request);
                  },
                }}
                nodeActions={{
                  onNewRequest: promptNewRequest,
                  onNewFolder: promptNewFolder,
                  onRename: promptRenameNode,
                  onPasteRequest: (cid, fp) => {
                    if (clipboard) {
                      void copyRequestInto(cid, fp, clipboard, clipboard.name);
                    }
                  },
                  onImportCurl: promptImportCurl,
                  onDelete: deleteNode,
                }}
                onMoveRequest={moveRequestAction}
                onMoveFolder={moveFolderAction}
                onSelect={selectGuarded}
                onNewCollection={promptNewCollection}
                onNewEnvironment={promptNewEnvironment}
                onImportPostman={importPostman}
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
      {showCookies && workspaceId && (
        <CookieManager
          workspaceId={workspaceId}
          onClose={() => setShowCookies(false)}
        />
      )}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
