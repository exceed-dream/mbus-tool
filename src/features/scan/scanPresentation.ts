export type NetworkScanMode = "quick" | "primary";

export function runSelectedScan(mode: NetworkScanMode, quick: () => void, primary: () => void): void {
  if (mode === "quick") quick();
  else primary();
}

export const NETWORK_PANEL_ORDER = ["Network operations", "Discovered devices", "Communication log"] as const;
export const NETWORK_OPERATION_COLUMNS = ["Connection", "Scan settings"] as const;
export const CONNECTION_ACTION_ORDER = ["Connect", "Start scan"] as const;
