import { useState } from 'react';
import type { Selection } from '../selection';
import type { WorkspaceTree } from '../types';

interface Props {
  tree: WorkspaceTree;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onNewCollection: () => void;
  onNewRequest: (collectionId: string) => void;
  onNewEnvironment: () => void;
}

export function Sidebar({
  tree,
  selection,
  onSelect,
  onNewCollection,
  onNewRequest,
  onNewEnvironment,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isSelected = (sel: Selection): boolean =>
    JSON.stringify(sel) === JSON.stringify(selection);

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Collections</span>
          <button
            className="icon-btn"
            title="New collection"
            onClick={onNewCollection}
          >
            +
          </button>
        </div>
        {tree.collections.length === 0 && (
          <p className="muted sidebar-empty">No collections yet.</p>
        )}
        {tree.collections.map((collection) => (
          <div key={collection.id}>
            <div
              className={
                isSelected({ kind: 'collection', collectionId: collection.id })
                  ? 'sidebar-row selected'
                  : 'sidebar-row'
              }
            >
              <button
                className="icon-btn chevron"
                onClick={() =>
                  setCollapsed((c) => ({
                    ...c,
                    [collection.id]: !c[collection.id],
                  }))
                }
              >
                {collapsed[collection.id] ? '▸' : '▾'}
              </button>
              <button
                className="row-label"
                onClick={() =>
                  onSelect({ kind: 'collection', collectionId: collection.id })
                }
              >
                {collection.name}
              </button>
              <button
                className="icon-btn"
                title="New request"
                onClick={() => onNewRequest(collection.id)}
              >
                +
              </button>
            </div>
            {!collapsed[collection.id] &&
              collection.requests.map((request) => (
                <div
                  key={request.id}
                  className={
                    isSelected({
                      kind: 'request',
                      collectionId: collection.id,
                      requestId: request.id,
                    })
                      ? 'sidebar-row request-row selected'
                      : 'sidebar-row request-row'
                  }
                >
                  <button
                    className="row-label"
                    onClick={() =>
                      onSelect({
                        kind: 'request',
                        collectionId: collection.id,
                        requestId: request.id,
                      })
                    }
                  >
                    <span
                      className={
                        request.type === 'graphql'
                          ? 'method-tag method-GQL'
                          : `method-tag method-${request.method}`
                      }
                    >
                      {request.type === 'graphql' ? 'GQL' : request.method}
                    </span>
                    {request.name}
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Environments</span>
          <button
            className="icon-btn"
            title="New environment"
            onClick={onNewEnvironment}
          >
            +
          </button>
        </div>
        {tree.environments.length === 0 && (
          <p className="muted sidebar-empty">No environments yet.</p>
        )}
        {tree.environments.map((env) => (
          <div
            key={env.id}
            className={
              isSelected({ kind: 'environment', environmentId: env.id })
                ? 'sidebar-row selected'
                : 'sidebar-row'
            }
          >
            <button
              className="row-label"
              onClick={() =>
                onSelect({ kind: 'environment', environmentId: env.id })
              }
            >
              {tree.activeEnvironmentId === env.id ? '● ' : '○ '}
              {env.name}
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer" title={tree.meta.path}>
        {tree.meta.path}
      </div>
    </aside>
  );
}
