export type Selection =
  | {
      kind: 'request';
      collectionId: string;
      folderPath: string[];
      requestId: string;
    }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; collectionId: string; folderPath: string[] }
  | { kind: 'environment'; environmentId: string }
  | null;
