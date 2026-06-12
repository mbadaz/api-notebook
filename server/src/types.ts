export type RequestType = 'http' | 'graphql';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  /**
   * Environment variables only: secret values are stored in the
   * gitignored <env>.local.json instead of the shared environment file.
   */
  secret?: boolean;
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';

export interface AuthConfig {
  type: AuthType;
  bearer?: { token: string };
  basic?: { username: string; password: string };
  apiKey?: { key: string; value: string; placement: 'header' | 'query' };
}

export type BodyMode = 'none' | 'json' | 'text' | 'form' | 'formData' | 'binary';

export interface FormDataField {
  key: string;
  /** Text value, or an absolute file path when type === 'file'. */
  value: string;
  type: 'text' | 'file';
  enabled: boolean;
}

export interface RequestBody {
  mode: BodyMode;
  content: string;
  form: KeyValue[];
  formData: FormDataField[];
  binaryPath: string;
}

export interface GraphQLBody {
  query: string;
  variables: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  type: RequestType;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  auth: AuthConfig;
  body: RequestBody;
  graphql: GraphQLBody;
  docs: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  requests: ApiRequest[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  path: string;
}

export interface WorkspaceTree {
  meta: WorkspaceMeta;
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
}

export interface ExecutionResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Response body: UTF-8 text, or base64 when bodyEncoding is 'base64'. */
  body: string;
  bodyEncoding: 'text' | 'base64';
  timeMs: number;
  sizeBytes: number;
  resolvedUrl: string;
}
