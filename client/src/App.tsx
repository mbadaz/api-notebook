import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { CollectionEditor } from './components/CollectionEditor';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { PromptModal, type PromptConfig } from './components/PromptModal';
import { RequestEditor } from './components/RequestEditor';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import type { Selection } from './selection';
import type { WorkspaceMeta, WorkspaceTree } from './types';
import { VariablesContext, type VariablesInfo } from './variables';

const LAST_WORKSPACE_KEY = 'apinotebook.lastWorkspace';

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [prompt, setPrompt] = useState<PromptConfig | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  function promptNewCollection() {
    if (!workspaceId) return;
    setPrompt({
      title: 'New Collection',
      fields: [{ name: 'name', label: 'Name', placeholder: 'Users API' }],
      onSubmit: async (values) => {
        const collection = await api.createCollection(workspaceId, values.name);
        await loadTree(workspaceId, true);
        setSelection({ kind: 'collection', collectionId: collection.id });
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
        setSelection({ kind: 'request', collectionId, requestId: request.id });
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
        setSelection({ kind: 'environment', environmentId: env.id });
      },
    });
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
            onDelete={async () => {
              if (!confirm(`Delete request "${request.name}"?`)) return;
              try {
                await api.deleteRequest(tree.meta.id, collection.id, request.id);
                setSelection(null);
                await loadTree(tree.meta.id, true);
              } catch (err) {
                showError(err);
              }
            }}
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
            onDelete={async () => {
              if (
                !confirm(
                  `Delete collection "${collection.name}" and all its requests?`
                )
              ) {
                return;
              }
              try {
                await api.deleteCollection(tree.meta.id, collection.id);
                setSelection(null);
                await loadTree(tree.meta.id, true);
              } catch (err) {
                showError(err);
              }
            }}
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
                await loadTree(tree.meta.id, true);
              } catch (err) {
                showError(err);
              }
            }}
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
        onSelectWorkspace={(id) => loadTree(id)}
        onNewWorkspace={promptNewWorkspace}
        onOpenWorkspace={promptOpenWorkspace}
        environments={tree?.environments ?? []}
        activeEnvironmentId={tree?.activeEnvironmentId ?? null}
        onSelectEnvironment={selectEnvironment}
      />
      <VariablesContext.Provider value={variablesInfo}>
        <div className="app-body">
          {tree && (
            <Sidebar
              tree={tree}
              selection={selection}
              onSelect={setSelection}
              onNewCollection={promptNewCollection}
              onNewRequest={promptNewRequest}
              onNewEnvironment={promptNewEnvironment}
            />
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
