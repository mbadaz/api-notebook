import { createContext } from 'react';

export interface VariablesInfo {
  /** Name of the active environment, or null when none is selected. */
  envName: string | null;
  /** Resolvable variables of the active environment (secrets without a local value excluded). */
  vars: Record<string, string>;
  /** Keys of all enabled variables, including unfilled secrets. */
  definedNames: string[];
  /** Keys of enabled variables marked secret. */
  secretNames: string[];
  /** Persist a variable's value to the active environment (creates it if missing). */
  setVariable?: (name: string, value: string) => Promise<void>;
}

export const VariablesContext = createContext<VariablesInfo>({
  envName: null,
  vars: {},
  definedNames: [],
  secretNames: [],
});
