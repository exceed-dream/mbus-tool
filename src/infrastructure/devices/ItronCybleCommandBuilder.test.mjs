import test from "node:test";
import assert from "node:assert/strict";
import { buildLongFrame, mbusChecksum, toHex } from "../../domain/mbus/MbusFrame.ts";
import { changedFields } from "../../domain/configuration/DeviceConfiguration.ts";
import { buildCustomerIdCommand, buildCybleConfigurationPlan, buildCybleInfoRequest, buildCybleMediumCommand, buildCyblePulseWeightWrite, buildCybleUnlockFrame, buildCybleVolumeCommand, buildGasCorrectedVolumeWithX10Command, buildGasMediumWithX10Command, buildGasRemoveX10Command, buildObservedRefreshCommand, buildSecondaryAddressCommand, encodeCustomerId, encodeSecondaryAddressBcd } from "./ItronCybleCommandBuilder.ts";
import { isApplyConfigurationEnabled } from "../../features/configuration/ConfigurationUiPolicy.ts";

test("central checksum and long-frame builder reproduce the observed refresh", () => {
  assert.equal(mbusChecksum([0x53, 0x05, 0xa6]), 0xfe);
  assert.equal(toHex(buildLongFrame({ control: 0x53, address: 5, ci: 0xa6 })), "68 03 03 68 53 05 A6 FE 16");
  assert.equal(toHex(buildObservedRefreshCommand(5)), "68 03 03 68 53 05 A6 FE 16");
  assert.equal(toHex(buildCybleInfoRequest(6)), "68 03 03 68 53 06 A6 FF 16");
});

test("target address is dynamic and checksum is recalculated", () => {
  assert.equal(toHex(buildObservedRefreshCommand(12)), "68 03 03 68 53 0C A6 05 16");
});

test("Customer ID retains the confirmed encoding", () => {
  assert.deepEqual(encodeCustomerId("334799"), [0x20,0x20,0x20,0x20,0x33,0x33,0x34,0x37,0x39,0x39,0,0,0,0,0,0,0,0,0,0]);
  assert.equal(toHex(buildCustomerIdCommand(5, "334799")), "68 19 19 68 53 05 A9 01 01 20 20 20 20 33 33 34 37 39 39 00 00 00 00 00 00 00 00 00 00 C6 16");
  assert.equal(toHex(buildCustomerIdCommand(7, "654323")), "68 19 19 68 53 07 A9 01 01 20 20 20 20 36 35 34 33 32 33 00 00 00 00 00 00 00 00 00 00 BC 16");
});

test("Secondary address preserves eight digits and reproduces the real write", () => {
  assert.deepEqual(encodeSecondaryAddressBcd("17017543"), [0x43, 0x75, 0x01, 0x17]);
  assert.deepEqual(encodeSecondaryAddressBcd("00125482"), [0x82, 0x54, 0x12, 0x00]);
  assert.equal(toHex(buildSecondaryAddressCommand(5, "17017543")), "68 09 09 68 53 05 51 0C 79 43 75 01 17 FE 16");
  assert.throws(() => encodeSecondaryAddressBcd("1234567"), /exactly 8/);
});

test("Volume derives raw and VIF once and reproduces the real 400.00 write", async () => {
  const { deriveCybleVolumeEncoding } = await import("../../domain/mbus/CybleVolumeEncoding.ts");
  const encoding = deriveCybleVolumeEncoding("400.00");
  assert.deepEqual(encoding, { normalized: "400.00", raw: 40000, resolution: "0.01", vif: 0x14, pulseWeightLitres: 10 });
  assert.equal(toHex(buildCybleVolumeCommand(5, encoding.raw, encoding.vif)), "68 0B 0B 68 53 05 A9 02 06 00 40 9C 00 00 14 F9 16");
});

test("normal Pulse weight writes reproduce the confirmed address 6 frames", () => {
  assert.equal(toHex(buildCyblePulseWeightWrite(6, "0.001")), "68 06 06 68 53 06 A9 01 00 13 16 16");
  assert.equal(toHex(buildCyblePulseWeightWrite(6, "0.01")), "68 06 06 68 53 06 A9 01 00 14 17 16");
  assert.equal(toHex(buildCyblePulseWeightWrite(6, "0.1")), "68 06 06 68 53 06 A9 01 00 15 18 16");
  assert.equal(buildCyblePulseWeightWrite(12, "0.1")[10], 0x1e);
});

test("normal Pulse weight builder covers the confirmed extreme codes at address 7", () => {
  assert.equal(toHex(buildCyblePulseWeightWrite(7, "0.000001")), "68 06 06 68 53 07 A9 01 00 10 14 16");
  assert.equal(toHex(buildCyblePulseWeightWrite(7, "0.00001")), "68 06 06 68 53 07 A9 01 00 11 15 16");
  assert.equal(toHex(buildCyblePulseWeightWrite(7, "0.0001")), "68 06 06 68 53 07 A9 01 00 12 16 16");
  assert.equal(toHex(buildCyblePulseWeightWrite(7, "1")), "68 06 06 68 53 07 A9 01 00 16 1A 16");
  assert.equal(toHex(buildCyblePulseWeightWrite(7, "10")), "68 06 06 68 53 07 A9 01 00 17 1B 16");
});

test("Cyble unlock writes the 16-bit CRC little-endian with a dynamic checksum", () => {
  assert.equal(toHex(buildCybleUnlockFrame(6, 0xf648)), "68 07 07 68 53 06 A5 80 00 48 F6 BC 16");
  assert.equal(toHex(buildCybleUnlockFrame(5, 0xeffc)), "68 07 07 68 53 05 A5 80 00 FC EF 68 16");
});

test("Cyble profile Medium destinations use the simple confirmed A9 command", () => {
  assert.equal(toHex(buildCybleMediumCommand(5, 0x16)), "68 06 06 68 53 05 A9 01 0A 16 22 16");
  for (const code of [0x07, 0x03, 0x16, 0x06, 0x00]) assert.equal(buildCybleMediumCommand(5, code)[9], code);
  assert.throws(() => buildCybleMediumCommand(5, 0x01), /not available/);
});

test("confirmed Gas commands remain exact", () => {
  assert.equal(toHex(buildGasRemoveX10Command(5)), "68 08 08 68 53 05 A9 02 00 0E 14 03 28 16");
  assert.equal(toHex(buildGasCorrectedVolumeWithX10Command(5)), "68 08 08 68 53 05 A9 02 0E 00 00 15 26 16");
  assert.equal(toHex(buildGasMediumWithX10Command(5)), "68 0F 0F 68 53 05 A9 04 0A 06 00 0E 03 00 00 00 00 15 01 3C 16");
});

test("Medium is planned before Volume with one TOTAL unlock preparation for the batch", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 7, 0x16), field("volume", "0.000", "400.00"),
    field("pulseWeightX10", false, false), field("correctedVolume", false, false),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["medium", "volume"]);
  assert.equal(plan.preparation, "cybleUnlockTotal");
  assertApplyEnabled(plan);
});

test("plan writes Volume before Primary Address and keeps the old target until the final operation", () => {
  const plan = buildCybleConfigurationPlan(configuration([field("primaryAddress", 5, 12), field("volume", "6", "400.00")]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["volume", "primaryAddress"]);
  assert.equal(plan.operations[0].targetAddress, 5);
  assert.equal(plan.operations[0].frame[5], 5);
});

test("coherent Volume and Pulse weight changes use only the Volume resolution write", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("volume", "0.000", "400.00"), field("pulseWeight", "0.001", "0.01"),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["volume"]);
  assertApplyEnabled(plan);
});

test("Pulse weight only is a prepared standalone operation after Volume in plan order", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 6, 6), field("pulseWeight", "0.01", "0.1"), field("customerId", "997321", "997322"),
  ]), 6);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["pulseWeight", "customerId"]);
  assert.deepEqual(plan.operations[0].frame.slice(6, 10), [0xa9, 0x01, 0x00, 0x15]);
  assert.equal(plan.preparation, "cybleUnlockTotal");
  assertApplyEnabled(plan);
});

test("incoherent Volume and explicit Pulse weight fail validation without a Pulse weight TX", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 6, 6), field("volume", "6", "12345.678"), field("pulseWeight", "0.01", "0.1"),
  ]), 6);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["volume"]);
  assert.match(plan.unsupported[0].reason, /inconsistent/);
  assert.equal(applyEnabled(plan), false);
});

test("an unconfirmed Pulse weight is rejected and produces no TX operation", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 6, 6), field("pulseWeight", "0.01", "0.5"),
  ]), 6);
  assert.equal(plan.operations.length, 0);
  assert.match(plan.unsupported[0].reason, /must be one of/);
  assert.equal(applyEnabled(plan), false);
});

test("unknown Gas combination produces no TX operation", () => {
  const plan = buildCybleConfigurationPlan(configuration([field("primaryAddress", 5, 5), field("medium", 0x03, 0x03), field("pulseWeightX10", false, false), field("correctedVolume", false, true)]), 5);
  assert.equal(plan.operations.length, 0);
  assert.match(plan.unsupported[0].reason, /not supported/);
});

test("Gas current to Cold Water ignores unknown Gas flags and enables prepared Medium TX", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 0x03, 0x16), field("pulseWeightX10", null, null), field("correctedVolume", null, null),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["medium"]);
  assertApplyEnabled(plan);
});

test("Water current to Cold Water is a pending and applicable prepared change", () => {
  const pending = configuration([field("primaryAddress", 5, 5), field("medium", 0x07, 0x16)]);
  const plan = buildCybleConfigurationPlan(pending, 5);
  assert.deepEqual(changedFields(pending).map((item) => item.id), ["medium"]);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["medium"]);
  assertApplyEnabled(plan);
});

test("transition to Gas uses the confirmed combined command when both flags are known", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 0x07, 0x03), field("pulseWeightX10", true, true), field("correctedVolume", false, false),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["medium,gasConfiguration"]);
  assertApplyEnabled(plan);
});

test("Cold Water to Gas uses false defaults without the former explicit-Boolean error", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 0x16, 0x03), field("pulseWeightX10", null, null), field("correctedVolume", null, null),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["medium", "gasConfiguration"]);
  assert.equal(plan.operations[1].requestedValue, false);
  assertApplyEnabled(plan);
  assert.equal(plan.unsupported.some((item) => /explicit Boolean/.test(item.reason)), false);
});

test("Water to Gas uses the same false defaults", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 0x07, 0x03), field("pulseWeightX10", null, null), field("correctedVolume", null, null),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["medium", "gasConfiguration"]);
  assertApplyEnabled(plan);
});

test("transition to an unconfirmed false/true Gas combination remains blocked", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 0x07, 0x03), field("pulseWeightX10", false, false), field("correctedVolume", false, true),
  ]), 5);
  assert.match(plan.unsupported[0].reason, /not supported/);
  assert.equal(applyEnabled(plan), false);
});

test("unchanged non-Gas Medium and unknown Gas flags do not block another supported change", () => {
  const plan = buildCybleConfigurationPlan(configuration([
    field("primaryAddress", 5, 5), field("medium", 0x07, 0x07), field("pulseWeightX10", null, null), field("correctedVolume", null, null), field("customerId", "123", "456"),
  ]), 5);
  assert.deepEqual(plan.operations.map((item) => item.parameter), ["customerId"]);
  assertApplyEnabled(plan);
});

function field(id, currentValue, requestedValue) { return { id, label: id, type: typeof currentValue === "boolean" ? "boolean" : "text", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED", currentValue, requestedValue }; }
function configuration(fields) { return { deviceId: "fixture", profileId: "itron-cyble-mbus-v2", readAt: "now", fields }; }
function applyEnabled(plan) { return isApplyConfigurationEnabled({ connected: true, changeCount: 1, validationValid: plan.unsupported.length === 0, busy: false, writeProtected: false }); }
function assertApplyEnabled(plan) { assert.equal(plan.unsupported.length, 0); assert.equal(applyEnabled(plan), true); }
