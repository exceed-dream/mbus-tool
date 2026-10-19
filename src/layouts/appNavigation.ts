export type AppPage = "scan" | "device-details" | "configuration" | "device-library" | "settings";

export interface BreadcrumbItem {
  label: string;
  target?: AppPage;
}

export const APP_BREADCRUMBS: Record<AppPage, readonly BreadcrumbItem[]> = {
  scan: [{ label: "Network", target: "scan" }, { label: "Scan" }],
  "device-details": [{ label: "Network", target: "scan" }, { label: "Scan", target: "scan" }, { label: "Device Details" }],
  configuration: [{ label: "Network", target: "scan" }, { label: "Scan", target: "scan" }, { label: "Device Details", target: "device-details" }, { label: "Configuration" }],
  "device-library": [{ label: "Devices", target: "device-library" }, { label: "Device Library" }],
  settings: [{ label: "System", target: "settings" }, { label: "Settings" }],
};

export function parentBreadcrumbItem(page: AppPage): BreadcrumbItem | undefined {
  const items = APP_BREADCRUMBS[page];
  const parent = items[items.length - 2];
  return parent?.target && parent.target !== page ? parent : undefined;
}

export function navigationRequiresConfirmation(currentPage: AppPage, targetPage: AppPage, unsavedConfigurationChanges: number): boolean {
  return currentPage === "configuration" && targetPage !== "configuration" && unsavedConfigurationChanges > 0;
}
