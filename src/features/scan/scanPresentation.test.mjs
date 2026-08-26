import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONNECTION_ACTION_ORDER, NETWORK_OPERATION_COLUMNS, NETWORK_PANEL_ORDER, runSelectedScan } from "./scanPresentation.ts";

test("Network uses one operational panel then a separate devices panel", () => {
  assert.deepEqual(NETWORK_PANEL_ORDER, ["Network operations", "Discovered devices", "Communication log"]);
  assert.deepEqual(NETWORK_OPERATION_COLUMNS, ["Connection", "Scan settings"]);
  assert.deepEqual(CONNECTION_ACTION_ORDER, ["Connect", "Start scan"]);
});

test("Start scan routes to the selected existing handler", () => {
  const calls = [];
  runSelectedScan("quick", () => calls.push("quick"), () => calls.push("primary"));
  runSelectedScan("primary", () => calls.push("quick"), () => calls.push("primary"));
  assert.deepEqual(calls, ["quick", "primary"]);
});

test("legacy devices-found badge and separate scan buttons are absent", () => {
  const source = readFileSync(new URL("./ScanPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /summary-pill|Start quick scan|Start primary scan/);
  assert.match(source, /network-scan-status/);
  assert.match(source, /title={`Discovered devices/);
});

test("Tauri main window is maximized, resizable and not fullscreen", () => {
  const config = JSON.parse(readFileSync(new URL("../../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const window = config.app.windows[0];
  assert.equal(window.maximized, true);
  assert.equal(window.fullscreen, false);
  assert.equal(window.resizable, true);
  assert.equal(window.minWidth, 1100);
  assert.equal(window.minHeight, 700);
});
