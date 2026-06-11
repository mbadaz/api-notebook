export type Selection =
  | { kind: 'request'; collectionId: string; requestId: string }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'environment'; environmentId: string }
  | null;
