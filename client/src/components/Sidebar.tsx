import { useState, type DragEvent, type MouseEvent } from 'react';
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
  onMoveRequest: (
    from: { collectionId: string; folderPath: string[]; requestId: string },
    to: { collectionId: string; folderPath: string[] }
  ) => void;
  onMoveFolder: (
    from: { collectionId: string; folderPath: string[] },
    to: { collectionId: string; folderPath: string[] }
  ) => void;
  onSelect: (selection: Selection) => void;
  onNewCollection: () => void;
  onNewEnvironment: () => void;
  onImportFile: () => void;
  onImportFolder: () => void;
}

type DragItem =
  | { kind: 'request'; collectionId: string; folderPath: string[]; requestId: string }
  | { kind: 'folder'; collectionId: string; folderPath: string[] };

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

function badgeLabel(request: ApiRequest): string {
  if (request.type === 'graphql') return 'GQL';
  if (request.type === 'websocket') return 'WS';
  return request.method;
}

function badgeClass(request: ApiRequest): string {
  if (request.type === 'graphql') return 'method-GQL';
  if (request.type === 'websocket') return 'method-WS';
  return `method-${request.method}`;
}

const INDENT = 16;

export function Sidebar({
  tree,
  selection,
  width,
  canPaste,
  requestActions,
  nodeActions,
  onMoveRequest,
  onMoveFolder,
  onSelect,
  onNewCollection,
  onNewEnvironment,
  onImportFile,
  onImportFolder,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const isSelected = (sel: Selection): boolean =>
    JSON.stringify(sel) === JSON.stringify(selection);

  const toggle = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  /** Whether the dragged item may drop into the given node (not a no-op/cycle). */
  function canDrop(item: DragItem, cid: string, folderPath: string[]): boolean {
    if (item.kind === 'folder') {
      if (item.collectionId !== cid) return true;
      const fromKey = item.folderPath.join('/');
      const intoKey = folderPath.slice(0, item.folderPath.length).join('/');
      // Into itself or a descendant.
      if (folderPath.length >= item.folderPath.length && intoKey === fromKey) {
        return false;
      }
      // Into its current parent (no change).
      return item.folderPath.slice(0, -1).join('/') !== folderPath.join('/');
    }
    // Request: a no-op when it's already in this node.
    return !(
      item.collectionId === cid &&
      item.folderPath.join('/') === folderPath.join('/')
    );
  }

  function onDropInto(cid: string, folderPath: string[]) {
    const item = drag;
    setDrag(null);
    setDropKey(null);
    if (!item || !canDrop(item, cid, folderPath)) return;
    if (item.kind === 'request') {
      onMoveRequest(
        {
          collectionId: item.collectionId,
          folderPath: item.folderPath,
          requestId: item.requestId,
        },
        { collectionId: cid, folderPath }
      );
    } else {
      onMoveFolder(
        { collectionId: item.collectionId, folderPath: item.folderPath },
        { collectionId: cid, folderPath }
      );
    }
  }

  /** Drop-target handlers for a node (collection or folder). */
  function dropTarget(cid: string, folderPath: string[], key: string) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!drag || !canDrop(drag, cid, folderPath)) return;
        e.preventDefault();
        if (dropKey !== key) setDropKey(key);
      },
      onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        onDropInto(cid, folderPath);
      },
    };
  }

  function dragSource(item: DragItem) {
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
        setDrag(item);
      },
      onDragEnd: () => {
        setDrag(null);
        setDropKey(null);
      },
    };
  }

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
        {...dragSource({ kind: 'request', collectionId, folderPath, requestId: request.id })}
      >
        <button className="row-label" onClick={() => onSelect(sel)}>
          <span className={`method-tag ${badgeClass(request)}`}>
            {badgeLabel(request)}
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
    const cls =
      (isSelected(sel) ? 'sidebar-row selected' : 'sidebar-row') +
      (dropKey === key ? ' drop-target' : '');
    return (
      <div key={`f:${folder.id}`}>
        <div
          className={cls}
          style={{ paddingLeft: depth * INDENT }}
          {...dragSource({ kind: 'folder', collectionId, folderPath })}
          {...dropTarget(collectionId, folderPath, key)}
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
    const cls =
      (isSelected({ kind: 'collection', collectionId: collection.id })
        ? 'sidebar-row selected'
        : 'sidebar-row') + (dropKey === key ? ' drop-target' : '');
    return (
      <div key={collection.id}>
        <div className={cls} {...dropTarget(collection.id, [], key)}>
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
              title="Import Postman exports"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setImportMenu({ x: rect.right, y: rect.bottom + 2 });
              }}
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

      {importMenu && (
        <>
          <div className="ctx-backdrop" onMouseDown={() => setImportMenu(null)} />
          <div
            className="ctx-menu"
            style={{
              top: importMenu.y,
              left: Math.min(importMenu.x, window.innerWidth - 190),
            }}
          >
            <button
              className="ctx-item"
              onClick={() => {
                setImportMenu(null);
                onImportFile();
              }}
            >
              Import file…
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                setImportMenu(null);
                onImportFolder();
              }}
            >
              Import folder…
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
