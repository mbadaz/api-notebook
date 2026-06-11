import type { Environment, WorkspaceMeta } from '../types';

interface Props {
  workspaces: WorkspaceMeta[];
  currentWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onOpenWorkspace: () => void;
  environments: Environment[];
  activeEnvironmentId: string | null;
  onSelectEnvironment: (id: string | null) => void;
}

export function TopBar({
  workspaces,
  currentWorkspaceId,
  onSelectWorkspace,
  onNewWorkspace,
  onOpenWorkspace,
  environments,
  activeEnvironmentId,
  onSelectEnvironment,
}: Props) {
  return (
    <header className="topbar">
      <span className="logo">API Notebook</span>
      <select
        className="workspace-select"
        value={currentWorkspaceId ?? ''}
        onChange={(e) => {
          const value = e.target.value;
          if (value === '__new') onNewWorkspace();
          else if (value === '__open') onOpenWorkspace();
          else if (value) onSelectWorkspace(value);
        }}
      >
        {!currentWorkspaceId && <option value="">Select a workspace…</option>}
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
        <option value="__new">＋ New workspace…</option>
        <option value="__open">⌂ Open existing folder…</option>
      </select>
      <div className="spacer" />
      {currentWorkspaceId && (
        <label className="env-select-label">
          Environment
          <select
            className="env-select"
            value={activeEnvironmentId ?? ''}
            onChange={(e) => onSelectEnvironment(e.target.value || null)}
          >
            <option value="">No environment</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </header>
  );
}
