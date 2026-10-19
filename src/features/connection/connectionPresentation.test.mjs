import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONNECTION_CONTROL_ORDER, CONNECTION_STATUS_ORDER } from "./connectionPresentation.ts";

const panelSource = readFileSync(new URL("./ConnectionPanel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");

test("connection controls use the requested horizontal order", () => {
  assert.deepEqual(CONNECTION_CONTROL_ORDER, ["Refresh", "Interface", "M-Bus mode", "Baud rate", "Timeout", "Serial format"]);
  const refresh = panelSource.indexOf("connection-refresh");
  const interfaceSelect = panelSource.indexOf("connection-interface-select");
  assert.ok(refresh >= 0 && interfaceSelect > refresh);
  assert.match(panelSource, /button--primary connection-refresh/);
  assert.match(css, /\.network-connection \.connection-refresh\{width:122px/);
  assert.match(css, /\.connection-interface-row\{display:grid;grid-template-columns:112px minmax\(0,1fr\)/);
});

test("connect action precedes the connection status", () => {
  assert.deepEqual(CONNECTION_STATUS_ORDER, ["Connect action", "Connection status"]);
});

test("Refresh, Interface, Connect and Start scan share the connection box", () => {
  const controlBox = panelSource.indexOf("connection-control-box");
  const refresh = panelSource.indexOf("connection-refresh", controlBox);
  const interfaceSelect = panelSource.indexOf("connection-interface-select", controlBox);
  const connect = panelSource.indexOf("connection-strip__action", controlBox);
  const startScanSlot = panelSource.indexOf("{afterConnect}", controlBox);
  const parameters = panelSource.indexOf("connection-parameters", controlBox);
  assert.ok(controlBox >= 0 && refresh > controlBox && interfaceSelect > refresh && connect > interfaceSelect && startScanSlot > connect && parameters > startScanSlot);
  assert.match(css, /\.network-primary-actions \.button\{width:100%\}/);
  assert.match(css, /\.network-connection \.connection-interface-row\{grid-template-columns:122px minmax\(0,1fr\)/);
});

test("network settings keep Serial format immediately after Timeout on one compact row", () => {
  const mode = panelSource.indexOf("M-Bus mode");
  const baud = panelSource.indexOf("Baud rate");
  const timeout = panelSource.indexOf("Timeout");
  const serial = panelSource.indexOf("Serial format");
  assert.ok(mode >= 0 && baud > mode && timeout > baud && serial > timeout);
  assert.match(css, /\.network-connection \.connection-parameters\{grid-template-columns:minmax\(82px,\.8fr\) minmax\(78px,\.7fr\) minmax\(78px,\.7fr\) minmax\(170px,1\.5fr\)/);
  assert.match(css, /\.network-connection \.connection-parameters \.connection-field:nth-child\(4\)\{grid-column:auto\}/);
});
