import assert from "node:assert/strict";
import test from "node:test";
import { upsertMbusDevices } from "./upsertMbusDevice.ts";

const rel = (primaryAddress, identificationNumber = "22075482") => ({
  id: `secondary-${identificationNumber}-48AC-09-01`,
  primaryAddress,
  secondaryAddress: { identificationNumber, manufacturerRaw: 0x48ac, version: 9, medium: 1 },
  manufacturer: "REL",
  manufacturerRaw: 0x48ac,
  identificationNumber,
  version: "9",
  medium: "Oil",
  mediumRaw: 1,
  baudRate: 2400,
  status: "online",
});

test("same secondary identity at a new primary address remains one device", () => {
  const initial = upsertMbusDevices([], [rel(3)]);
  const updated = upsertMbusDevices(initial, [rel(2)]);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].primaryAddress, 2);
});

test("verified primary address change updates the row and shows 3 to 2", () => {
  const oldDevice = rel(3);
  const initial = upsertMbusDevices([], [oldDevice]);
  const updated = upsertMbusDevices(initial, [rel(2)], { replaces: oldDevice, showPrimaryAddressChange: true });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].previousPrimaryAddress, 3);
  assert.equal(updated[0].primaryAddress, 2);
  assert.equal(updated[0].listKey, initial[0].listKey);
});

test("a subsequent scan clears the temporary address transition", () => {
  const oldDevice = rel(3);
  const changed = upsertMbusDevices(upsertMbusDevices([], [oldDevice]), [rel(2)], { replaces: oldDevice, showPrimaryAddressChange: true });
  const rescanned = upsertMbusDevices(changed, [rel(2)]);
  assert.equal(rescanned.length, 1);
  assert.equal(rescanned[0].previousPrimaryAddress, undefined);
});

test("quick and primary representations merge by secondary identity", () => {
  const quick = { ...rel(undefined), primaryAddress: undefined };
  const merged = upsertMbusDevices(upsertMbusDevices([], [quick]), [rel(2)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].primaryAddress, 2);
});

test("partial identity uses identification number and manufacturer", () => {
  const partial = { ...rel(3), secondaryAddress: undefined };
  const merged = upsertMbusDevices(upsertMbusDevices([], [partial]), [rel(2)]);
  assert.equal(merged.length, 1);
});

test("same identification and manufacturer remain stable when secondary details evolve", () => {
  const original = rel(3);
  const updatedIdentity = {
    ...rel(2),
    secondaryAddress: { ...rel(2).secondaryAddress, version: 10, medium: 7 },
    version: "10",
    medium: "Water",
    mediumRaw: 7,
  };
  const merged = upsertMbusDevices(upsertMbusDevices([], [original]), [updatedIdentity]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].primaryAddress, 2);
});

test("verified secondary ID replacement keeps one row and its React key", () => {
  const oldDevice = rel(3, "22075482");
  const initial = upsertMbusDevices([], [oldDevice]);
  const updated = upsertMbusDevices(initial, [rel(3, "00125482")], { replaces: oldDevice });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].identificationNumber, "00125482");
  assert.equal(updated[0].id, "secondary-00125482-48AC-09-01");
  assert.equal(updated[0].listKey, initial[0].listKey);
});

test("combined primary and secondary replacement reconciles one existing device", () => {
  const oldDevice = rel(5, "17017649");
  const initial = upsertMbusDevices([], [oldDevice]);
  const updated = upsertMbusDevices(initial, [rel(4, "17017543")], { replaces: oldDevice, showPrimaryAddressChange: true });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].primaryAddress, 4);
  assert.equal(updated[0].identificationNumber, "17017543");
  assert.equal(updated[0].listKey, initial[0].listKey);
});

test("primary address is only a fallback when no secondary identity exists", () => {
  const first = { id: "primary-4", primaryAddress: 4, baudRate: 2400, status: "online" };
  const reread = { ...first, status: "warning" };
  const merged = upsertMbusDevices(upsertMbusDevices([], [first]), [reread]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "warning");
});
