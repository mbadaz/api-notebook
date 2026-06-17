import { useState, type MouseEvent } from 'react';
import type { Selection } from '../selection';
import type { ApiRequest, Collection, Folder, WorkspaceTree } from '../types';

export interface RequestActions {
  onRename: (collectionId: string, folderPath: string[], requestId: string) => void;
  onCopy: (collectionId: string, folderPath: string[], requestId: string) => void;
  onDuplicate: (collectionId: string, folderPath: string[], requestId: string) => void;
  onDelete: (collectionId: string, folderPath: string[], requestId: string) => void;
}

/** Actions on a container node — a collection (folderPath []) or a folder. */
export interface NodeActions {
  onNewRequest: (collectionId: string, folderPath: string[]) => void;
  onNewFolder: (collectionId: string, folderPath: string[]) => void;
  onRename: (collectionId: string, folderPath: string[]) => void;
  onPasteRequest: (collectionId: string, folderPath: string[]) => void;
  onImportCurl: (collectionId: string, folderPath: string[]) => void;
  onDelete: (collectionId: string, folderPath: string[]) => void;
}

interface Props {
  tree: WorkspaceTree;
  selection: Selection;
  width: number;
  canPaste: boolean;
  requestActions: RequestActions;
  nodeActions: NodeActions;
  onSelect: (selection: Selection) => void;
  onNewCollection: () => void;
  onNewEnvironment: () => void;
  onImportPostman: () => void;
}

interface MenuState {
  kind: 'request' | 'node';
  collectionId: string;
  folderPath: string[];
  requestId?: string;
  /** True for a collection root node (vs. a folder), to label its menu. */
  isCollection?: boolean;
  x: number;
  y: number;
}

interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

const pathKey = (collectionId: string, folderPath: string[]): string =>
  [collectionId, ...folderPath].join('/');

const INDENT = 16;

export function Sidebar({
  tree,
  selection,
  width,
  canPaste,
  requestActions,
  nodeActions,
  onSelect,
  onNewCollection,
  onNewEnvironment,
  onImportPostman,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const isSelected = (sel: Selection): boolean =>
    JSON.stringify(sel) === JSON.stringify(selection);

  const toggle = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  function openMenu(
    e: MouseEvent<HTMLButtonElement>,
    state: Omit<MenuState, 'x' | 'y'>
  ) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ ...state, x: rect.right, y: rect.bottom + 2 });
  }

  function menuItems(m: MenuState): MenuItem[] {
    const { collectionId: cid, folderPath: fp } = m;
    if (m.kind === 'request') {
      const rid = m.requestId!;
      return [
        { label: 'Rename…', action: () => requestActions.onRename(cid, fp, rid) },
        { label: 'Copy', action: () => requestActions.onCopy(cid, fp, rid) },
        { label: 'Duplicate', action: () => requestActions.onDuplicate(cid, fp, rid) },
        { label: 'Delete', danger: true, action: () => requestActions.onDelete(cid, fp, rid) },
      ];
    }
    return [
      { label: 'New Request…', action: () => nodeActions.onNewRequest(cid, fp) },
      { label: 'New Folder…', action: () => nodeActions.onNewFolder(cid, fp) },
      { label: 'Rename…', action: () => nodeActions.onRename(cid, fp) },
      {
        label: 'Paste Request',
        disabled: !canPaste,
        action: () => nodeActions.onPasteRequest(cid, fp),
      },
      { label: 'Import cURL…', action: () => nodeActions.onImportCurl(cid, fp) },
      {
        label: m.isCollection ? 'Delete Collection' : 'Delete Folder',
        danger: true,
        action: () => nodeActions.onDelete(cid, fp),
      },
    ];
  }

  function renderRequest(
    collectionId: string,
    folderPath: string[],
    request: ApiRequest,
    depth: number
  ) {
    const sel: Selection = {
      kind: 'request',
      collectionId,
      folderPath,
      requestId: request.id,
    };
    return (
      <div
        key={`r:${request.id}`}
        className={isSelected(sel) ? 'sidebar-row request-row selected' : 'sidebar-row request-row'}
        style={{ paddingLeft: depth * INDENT + 22 }}
      >
        <button className="row-label" onClick={() => onSelect(sel)}>
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
              collectionId,
              folderPath,
              requestId: request.id,
            })
          }
        >
          ⋯
        </button>
      </div>
    );
  }

  function renderFolder(
    collectionId: string,
    parentPath: string[],
    folder: Folder,
    depth: number
  ) {
    const folderPath = [...parentPath, folder.id];
    const key = pathKey(collectionId, folderPath);
    const sel: Selection = { kind: 'folder', collectionId, folderPath };
    return (
      <div key={`f:${folder.id}`}>
        <div
          className={isSelected(sel) ? 'sidebar-row selected' : 'sidebar-row'}
          style={{ paddingLeft: depth * INDENT }}
        >
          <button className="icon-btn chevron" onClick={() => toggle(key)}>
            {collapsed[key] ? '▸' : '▾'}
          </button>
          <button className="row-label" onClick={() => onSelect(sel)}>
            <span className="folder-tag">▥</span>
            {folder.name}
          </button>
          <button
            className="icon-btn"
            title="Folder actions"
            onClick={(e) => openMenu(e, { kind: 'node', collectionId, folderPath })}
          >
            ⋯
          </button>
        </div>
        {!collapsed[key] &&
          renderChildren(collectionId, folderPath, folder, depth + 1)}
      </div>
    );
  }

  function renderChildren(
    collectionId: string,
    folderPath: string[],
    node: { folders: Folder[]; requests: ApiRequest[] },
    depth: number
  ) {
    return (
      <>
        {node.folders.map((f) => renderFolder(collectionId, folderPath, f, depth))}
        {node.requests.map((r) => renderRequest(collectionId, folderPath, r, depth))}
      </>
    );
  }

  function renderCollection(collection: Collection) {
    const key = pathKey(collection.id, []);
    return (
      <div key={collection.id}>
        <div
          className={
            isSelected({ kind: 'collection', collectionId: collection.id })
              ? 'sidebar-row selected'
              : 'sidebar-row'
          }
        >
          <button className="icon-btn chevron" onClick={() => toggle(key)}>
            {collapsed[key] ? '▸' : '▾'}
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
              openMenu(e, {
                kind: 'node',
                collectionId: collection.id,
                folderPath: [],
                isCollection: true,
              })
            }
          >
            ⋯
          </button>
        </div>
        {!collapsed[key] && renderChildren(collection.id, [], collection, 1)}
      </div>
    );
  }

  return (
    <aside className="sidebar" style={{ width, minWidth: width }}>
      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Collections</span>
          <span className="sidebar-heading-actions">
            <button
              className="icon-btn"
              title="Import a Postman collection or environment export"
              onClick={onImportPostman}
            >
              ⤓
            </button>
            <button
              className="icon-btn"
              title="New collection"
              onClick={onNewCollection}
            >
              +
            </button>
          </span>
        </div>
        {tree.collections.length === 0 && (
          <p className="muted sidebar-empty">No collections yet.</p>
        )}
        {tree.collections.map((collection) => renderCollection(collection))}
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
