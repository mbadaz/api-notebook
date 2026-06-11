import { createContext } from 'react';

export interface VariablesInfo {
  /** Name of the active environment, or null when none is selected. */
  envName: string | null;
  /** Enabled variables of the active environment. */
  vars: Record<string, string>;
}

export const VariablesContext = createContext<VariablesInfo>({
  envName: null,
  vars: {},
});
