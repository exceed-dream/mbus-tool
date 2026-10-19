import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { APP_BREADCRUMBS, navigationRequiresConfirmation, parentBreadcrumbItem } from "./appNavigation.ts";

const shellSource = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const deviceDetailsSource = readFileSync(new URL("../features/device-details/DeviceDetailsPage.tsx", import.meta.url), "utf8");
const configurationSource = readFileSync(new URL("../features/configuration/ConfigurationPage.tsx", import.meta.url), "utf8");

test("Network pages expose the requested hierarchical breadcrumbs", () => {
  assert.deepEqual(APP_BREADCRUMBS.scan.map((item) => item.label), ["Network", "Scan"]);
  assert.deepEqual(APP_BREADCRUMBS["device-details"].map((item) => item.label), ["Network", "Scan", "Device Details"]);
  assert.deepEqual(APP_BREADCRUMBS.configuration.map((item) => item.label), ["Network", "Scan", "Device Details", "Configuration"]);
  assert.equal(APP_BREADCRUMBS.configuration[0].target, "scan");
  assert.equal(APP_BREADCRUMBS.configuration[1].target, "scan");
  assert.equal(APP_BREADCRUMBS.configuration[2].target, "device-details");
  assert.equal(APP_BREADCRUMBS.configuration[3].target, undefined);
});

test("breadcrumb navigation is centralized and no longer displays M-Bus Tool", () => {
  assert.match(shellSource, /<Breadcrumb items=\{APP_BREADCRUMBS\[currentPage\]\}/);
  assert.doesNotMatch(shellSource, /<span>M-Bus Tool<\/span>/);
});

test("content back arrow uses the immediate breadcrumb parent", () => {
  assert.equal(parentBreadcrumbItem("scan"), undefined);
  assert.deepEqual(parentBreadcrumbItem("device-details"), { label: "Scan", target: "scan" });
  assert.deepEqual(parentBreadcrumbItem("configuration"), { label: "Device Details", target: "device-details" });
  assert.match(shellSource, /title={`Back to \${parent\.label}`}/);
  assert.match(shellSource, /onClick=\{\(\) => onNavigate\(parent\.target!\)\}/);
  assert.match(shellSource, /<Icon name="chevron-left"\/>/);
});

test("navigation only changes the current page and cannot start M-Bus communication", () => {
  const start = appSource.indexOf("const navigate =");
  const end = appSource.indexOf("const scanPage =", start);
  const navigateSource = appSource.slice(start, end);
  assert.match(navigateSource, /setPage\(targetPage\)/);
  assert.doesNotMatch(navigateSource, /scanPrimary|scanSecondary|readDevice|readCurrentConfiguration|mbusService/);
  assert.doesNotMatch(navigateSource, /setDevices|setSelectedDevice|setSettings/);
});

test("leaving Configuration protects unsaved changes", () => {
  assert.equal(navigationRequiresConfirmation("configuration", "device-details", 1), true);
  assert.equal(navigationRequiresConfirmation("configuration", "scan", 2), true);
  assert.equal(navigationRequiresConfirmation("configuration", "scan", 0), false);
  assert.equal(navigationRequiresConfirmation("device-details", "scan", 3), false);
  assert.match(appSource, /window\.confirm\("Discard unsaved configuration changes and leave this page\?"\)/);
});

test("redundant content back buttons are removed", () => {
  assert.doesNotMatch(deviceDetailsSource, /Back to network|onBack/);
  assert.doesNotMatch(configurationSource, /Back to network|Back to device|onBackToNetwork|onBackToDevice/);
});
