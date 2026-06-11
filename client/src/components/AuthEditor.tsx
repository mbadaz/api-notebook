import type { AuthConfig, AuthType } from '../types';
import { VarField } from './VarField';

interface Props {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apiKey', label: 'API Key' },
];

export function AuthEditor({ auth, onChange }: Props) {
  const bearer = auth.bearer ?? { token: '' };
  const basic = auth.basic ?? { username: '', password: '' };
  const apiKey = auth.apiKey ?? {
    key: '',
    value: '',
    placement: 'header' as const,
  };

  return (
    <div className="auth-editor">
      <label className="field">
        <span>Type</span>
        <select
          value={auth.type}
          onChange={(e) =>
            onChange({ ...auth, type: e.target.value as AuthType })
          }
        >
          {AUTH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {auth.type === 'bearer' && (
        <label className="field">
          <span>Token</span>
          <VarField
            value={bearer.token}
            placeholder="{{token}} or a literal token"
            onChange={(token) => onChange({ ...auth, bearer: { token } })}
          />
        </label>
      )}

      {auth.type === 'basic' && (
        <>
          <label className="field">
            <span>Username</span>
            <VarField
              value={basic.username}
              onChange={(username) =>
                onChange({ ...auth, basic: { ...basic, username } })
              }
            />
          </label>
          <label className="field">
            <span>Password</span>
            <VarField
              value={basic.password}
              placeholder="{{password}} keeps secrets out of the saved file"
              onChange={(password) =>
                onChange({ ...auth, basic: { ...basic, password } })
              }
            />
          </label>
        </>
      )}

      {auth.type === 'apiKey' && (
        <>
          <label className="field">
            <span>Key</span>
            <VarField
              value={apiKey.key}
              placeholder="X-Api-Key"
              onChange={(key) =>
                onChange({ ...auth, apiKey: { ...apiKey, key } })
              }
            />
          </label>
          <label className="field">
            <span>Value</span>
            <VarField
              value={apiKey.value}
              placeholder="{{apiKey}}"
              onChange={(value) =>
                onChange({ ...auth, apiKey: { ...apiKey, value } })
              }
            />
          </label>
          <label className="field">
            <span>Add to</span>
            <select
              value={apiKey.placement}
              onChange={(e) =>
                onChange({
                  ...auth,
                  apiKey: {
                    ...apiKey,
                    placement: e.target.value as 'header' | 'query',
                  },
                })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </label>
        </>
      )}

      {auth.type === 'none' && (
        <p className="muted">No authentication will be applied.</p>
      )}
    </div>
  );
}
