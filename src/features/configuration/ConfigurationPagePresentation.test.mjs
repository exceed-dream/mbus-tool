import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ConfigurationPage.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");

test("Configuration shows a dedicated contextual Communication log below the installer workflow", () => {
  assert.match(source, /title="Communication log"/);
  assert.match(source, /operationCommunicationLog\.entries/);
  assert.match(source, /operation-communication-entry/);
});

test("Read and Apply each start a fresh contextual operation log", () => {
  assert.match(source, /startOperationLog\("READ_CONFIGURATION"\)/);
  assert.match(source, /startOperationLog\("APPLY_CONFIGURATION"\)/);
});

test("verified snapshot is retained before updating the device", () => {
  const retain = source.indexOf("retainVerifiedSnapshot(");
  const update = source.indexOf("onDeviceUpdated(updatedDevice)");
  assert.ok(retain >= 0 && update > retain);
});

test("Pulse weight pending changes distinguish explicit edits from Volume-derived resolution", () => {
  assert.match(source, /pulseWeightExplicitlyChanged/);
  assert.match(source, /!pulseWeightExplicitlyChanged/);
  assert.match(source, /Derived from volume resolution/);
});

test("Gas controls use neutral confirmed wording and expose unavailable read-back", () => {
  assert.match(source, /Gas settings/);
  assert.match(source, /Indicates that the volume is corrected to reference temperature and pressure conditions\./);
  assert.match(source, /Gas-specific Cyble pulse-weight option\./);
  assert.match(source, /Write · read-back unavailable/);
});

test("Configuration reports unsaved changes to centralized navigation", () => {
  assert.match(source, /onUnsavedChangesChange\(changes\.length\)/);
  assert.match(source, /return \(\) => onUnsavedChangesChange\(0\)/);
  assert.match(appSource, /onUnsavedChangesChange=\{setUnsavedConfigurationChanges\}/);
  assert.doesNotMatch(source, /Back to network|Back to device/);
});

test("Configuration uses a responsive Parameters then operation two-column workspace", () => {
  const parameters = source.indexOf('className="configuration-workspace__parameters"');
  const operation = source.indexOf('className="configuration-workspace__operation"');
  const log = source.indexOf('title="Communication log"', operation);
  assert.ok(parameters >= 0 && operation > parameters && log > operation);
  assert.match(css, /\.configuration-workspace\{display:grid;grid-template-columns:minmax\(0,1\.4fr\) minmax\(360px,1fr\)/);
  assert.match(css, /@media\(max-width:1100px\)\{\.configuration-workspace\{grid-template-columns:1fr\}\}/);
});

test("Apply changes remains the only write trigger alongside Reset changes", () => {
  assert.match(source, />Reset changes<\/button>/);
  assert.match(source, />Apply changes<\/button>/);
  assert.equal(source.match(/onClick=\{applyConfiguration\}/g)?.length, 1);
});
