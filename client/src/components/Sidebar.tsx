import { useState, type MouseEvent } from 'react';
import type { Selection } from '../selection';
import type { WorkspaceTree } from '../types';

export interface RequestActions {
  onRename: (collectionId: string, requestId: string) => void;
  onCopy: (collectionId: string, requestId: string) => void;
  onDuplicate: (collectionId: string, requestId: string) => void;
  onDelete: (collectionId: string, requestId: string) => void;
}

export interface CollectionActions {
  onNewRequest: (collectionId: string) => void;
  onRename: (collectionId: string) => void;
  onPasteRequest: (collectionId: string) => void;
  onImportCurl: (collectionId: string) => void;
  onDelete: (collectionId: string) => void;
}

interface Props {
  tree: WorkspaceTree;
  selection: Selection;
  width: number;
  canPaste: boolean;
  requestActions: RequestActions;
  collectionActions: CollectionActions;
  onSelect: (selection: Selection) => void;
  onNewCollection: () => void;
  onNewEnvironment: () => void;
}

interface MenuState {
  kind: 'request' | 'collection';
  collectionId: string;
  requestId?: string;
  x: number;
  y: number;
}

interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

export function Sidebar({
  tree,
  selection,
  width,
  canPaste,
  requestActions,
  collectionActions,
  onSelect,
  onNewCollection,
  onNewEnvironment,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const isSelected = (sel: Selection): boolean =>
    JSON.stringify(sel) === JSON.stringify(selection);

  function openMenu(
    e: MouseEvent<HTMLButtonElement>,
    state: Omit<MenuState, 'x' | 'y'>
  ) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ ...state, x: rect.right, y: rect.bottom + 2 });
  }

  function menuItems(m: MenuState): MenuItem[] {
    const cid = m.collectionId;
    if (m.kind === 'request') {
      const rid = m.requestId!;
      return [
        { label: 'Rename…', action: () => requestActions.onRename(cid, rid) },
        { label: 'Copy', action: () => requestActions.onCopy(cid, rid) },
        { label: 'Duplicate', action: () => requestActions.onDuplicate(cid, rid) },
        { label: 'Delete', danger: true, action: () => requestActions.onDelete(cid, rid) },
      ];
    }
    return [
      { label: 'New Request…', action: () => collectionActions.onNewRequest(cid) },
      { label: 'Rename…', action: () => collectionActions.onRename(cid) },
      {
        label: 'Paste Request',
        disabled: !canPaste,
        action: () => collectionActions.onPasteRequest(cid),
      },
      { label: 'Import cURL…', action: () => collectionActions.onImportCurl(cid) },
      { label: 'Delete', danger: true, action: () => collectionActions.onDelete(cid) },
    ];
  }

  return (
    <aside className="sidebar" style={{ width, minWidth: width }}>
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
                title="Collection actions"
                onClick={(e) =>
                  openMenu(e, { kind: 'collection', collectionId: collection.id })
                }
              >
                ⋯
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
                  <button
                    className="icon-btn"
                    title="Request actions"
                    onClick={(e) =>
                      openMenu(e, {
                        kind: 'request',
                        collectionId: collection.id,
                        requestId: request.id,
                      })
                    }
                  >
                    ⋯
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

      {menu && (
        <>
          <div className="ctx-backdrop" onMouseDown={() => setMenu(null)} />
          <div
            className="ctx-menu"
            style={{
              top: menu.y,
              left: Math.min(menu.x, window.innerWidth - 190),
            }}
          >
            {menuItems(menu).map((item) => (
              <button
                key={item.label}
                className={item.danger ? 'ctx-item ctx-danger' : 'ctx-item'}
                disabled={item.disabled}
                onClick={() => {
                  setMenu(null);
                  item.action();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
