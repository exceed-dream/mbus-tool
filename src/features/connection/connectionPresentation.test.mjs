import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONNECTION_CONTROL_ORDER, CONNECTION_STATUS_ORDER } from "./connectionPresentation.ts";

const panelSource = readFileSync(new URL("./ConnectionPanel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");

test("connection controls use the requested horizontal order", () => {
  assert.deepEqual(CONNECTION_CONTROL_ORDER, ["Interface", "Refresh", "M-Bus mode", "Baud rate", "Timeout", "Serial format"]);
});

test("connect action precedes the connection status", () => {
  assert.deepEqual(CONNECTION_STATUS_ORDER, ["Connect action", "Connection status"]);
});

test("network settings keep Serial format immediately after Timeout on one compact row", () => {
  const mode = panelSource.indexOf("M-Bus mode");
  const baud = panelSource.indexOf("Baud rate");
  const timeout = panelSource.indexOf("Timeout");
  const serial = panelSource.indexOf("Serial format");
  assert.ok(mode >= 0 && baud > mode && timeout > baud && serial > timeout);
  assert.match(css, /\.network-connection \.connection-form\{grid-template-columns:minmax\(82px,\.8fr\) minmax\(78px,\.7fr\) minmax\(78px,\.7fr\) minmax\(170px,1\.5fr\)/);
  assert.match(css, /\.network-connection \.connection-field:nth-child\(5\)\{grid-column:auto\}/);
});
