import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canExportDevices, DEVICE_EXPORT_OPTIONS } from "./devicesExportPresentation.ts";

const menuSource = readFileSync(new URL("./DevicesExportMenu.tsx", import.meta.url), "utf8");
const scanSource = readFileSync(new URL("./ScanPage.tsx", import.meta.url), "utf8");

test("device export menu exposes CSV, Excel and PDF", () => {
  assert.deepEqual(DEVICE_EXPORT_OPTIONS.map(({ label, extension }) => [label, extension]), [
    ["CSV", ".csv"], ["Excel", ".xlsx"], ["PDF", ".pdf"],
  ]);
});

test("device export is disabled until at least one device is available", () => {
  assert.equal(canExportDevices(0), false);
  assert.equal(canExportDevices(1), true);
});

test("Discovered devices renders an accessible Export menu using the disabled policy", () => {
  assert.match(scanSource, /<DevicesExportMenu deviceCount=\{devices\.length\}/);
  assert.match(menuSource, /disabled=\{!enabled\}/);
  assert.match(menuSource, /aria-haspopup="menu"/);
  assert.match(menuSource, /role="menu"/);
  assert.match(menuSource, /DEVICE_EXPORT_OPTIONS\.map/);
});
