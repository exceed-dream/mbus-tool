import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONNECTION_ACTION_ORDER, hasAddressesToComplete, NETWORK_OPERATION_COLUMNS, NETWORK_PANEL_ORDER, runSelectedScan } from "./scanPresentation.ts";

const mockClientSource = readFileSync(new URL("../../infrastructure/mbus/MockMbusClient.ts", import.meta.url), "utf8");

test("Network uses one operational panel then a separate devices panel", () => {
  assert.deepEqual(NETWORK_PANEL_ORDER, ["Connection / Scan settings", "Discovered devices", "Communication log"]);
  assert.deepEqual(NETWORK_OPERATION_COLUMNS, ["Connection", "Scan settings"]);
  assert.deepEqual(CONNECTION_ACTION_ORDER, ["Connect", "Start scan"]);
});

test("Start scan routes to the selected existing handler", () => {
  const calls = [];
  runSelectedScan("quick", () => calls.push("quick"), () => calls.push("primary"));
  runSelectedScan("primary", () => calls.push("quick"), () => calls.push("primary"));
  assert.deepEqual(calls, ["quick", "primary"]);
});

test("mock secondary discovery includes an unresolved device for completion testing", () => {
  assert.match(mockClientSource, /protocolHint === "RELAY_PADPULS_M1"/);
  assert.match(mockClientSource, /primaryAddress: undefined/);
  assert.match(mockClientSource, /completeMissingPrimaryAddresses/);
});

test("completion action is visible only for a complete secondary identity with no primary address", () => {
  const identity = { identificationNumber: "22075482", manufacturerRaw: 0x48ac, version: 9, medium: 1 };
  const device = { id: "padpuls", baudRate: 2400, status: "online", secondaryAddress: identity };
  assert.equal(hasAddressesToComplete([device]), true);
  assert.equal(hasAddressesToComplete([{ ...device, primaryAddress: 4 }]), false);
  assert.equal(hasAddressesToComplete([{ ...device, secondaryAddress: undefined }]), false);
});

test("legacy devices-found badge and separate scan buttons are absent", () => {
  const source = readFileSync(new URL("./ScanPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /summary-pill|Start quick scan|Start primary scan/);
  assert.match(source, /network-scan-status/);
  assert.match(source, /title={`Discovered devices/);
  assert.match(source, /Complete missing addresses/);
});

test("Network header uses an accessible info tooltip and removes redundant permanent copy", () => {
  const source = readFileSync(new URL("./ScanPage.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../../components/PageHeader.tsx", import.meta.url), "utf8");
  const infoTooltip = readFileSync(new URL("../../components/InfoTooltip.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");
  assert.match(source, /titleInfo="Connect to a master, discover devices and inspect their data\."/);
  assert.doesNotMatch(source, /description="Connect to a master/);
  assert.doesNotMatch(source, /title="Network operations"|Connect the Techbase interface/);
  assert.match(header, /<InfoTooltip/);
  assert.match(infoTooltip, /aria-describedby=\{tooltipId\}/);
  assert.match(infoTooltip, /role="tooltip"/);
  assert.match(css, /\.info-tooltip:hover \[role="tooltip"\],\.info-tooltip:focus-within \[role="tooltip"\]/);
});

test("Network has no permanent Ready status bar", () => {
  const source = readFileSync(new URL("./ScanPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /: "Ready"/);
  assert.match(source, /\{statusText && <div className=\{`network-scan-status/);
  assert.match(source, /scanStatus === "reading" \? "Reading device…"/);
  assert.match(source, /scanStatus === "error" \? "Operation failed"/);
  assert.match(source, /progress\?\.kind === "primary"/);
});

test("Communication log is collapsed by default without unmounting its entries", () => {
  const source = readFileSync(new URL("./ScanPage.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/Panel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");
  assert.match(source, /title="Communication log" description="Primary, secondary, TX\/RX and collision diagnostics for this session\." collapsible defaultExpanded=\{false\}/);
  assert.match(panel, /aria-expanded=\{expanded\}/);
  assert.match(panel, /onClick=\{\(\) => setExpanded\(\(current\) => !current\)\}/);
  assert.match(panel, /hidden=\{collapsible && !expanded\}>\{children\}/);
  assert.match(panel, /expanded \? "chevron-down" : "chevron"/);
  assert.match(css, /\.panel__header--toggle\{[^}]*appearance:none;border:0;border-radius:0/);
  assert.match(css, /\.panel__header--toggle\[aria-expanded="true"\]\{border-bottom:1px solid #e4e9ed\}/);
  assert.match(css, /\.panel__header--toggle:focus-visible\{outline:/);
});

test("sidebar remains the only permanent global connection indicator", () => {
  const shell = readFileSync(new URL("../../layouts/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<span>M-Bus Master<\/span>/);
  assert.match(shell, /"No connection"/);
  assert.doesNotMatch(shell, /topbar__status|REAL MODE|mode\.toUpperCase\(\)|Connected to/);
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
