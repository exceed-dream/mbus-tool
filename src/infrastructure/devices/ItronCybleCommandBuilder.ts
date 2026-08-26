import type { ConfigurationField, DeviceConfiguration } from "../../domain/configuration/DeviceConfiguration.ts";
import { changedFields, sameValue } from "../../domain/configuration/DeviceConfiguration.ts";
import type { ConfigurationPlan, ConfigurationPlanOperation } from "../../domain/configuration/ConfigurationPlan.ts";
import { deriveCybleVolumeEncoding } from "../../domain/mbus/CybleVolumeEncoding.ts";
import { deriveCybleResolutionCodeFromPulseWeight, sameCyblePulseWeight } from "../../domain/mbus/CyblePulseWeight.ts";
import { buildLongFrame } from "../../domain/mbus/MbusFrame.ts";
import { cybleMediumOptions } from "../../domain/mbus/CybleConfigurationPolicy.ts";
import { MBUS_MEDIUM_GAS } from "../../domain/mbus/MbusMedium.ts";

const CONTROL_SND_UD = 0x53;
const CI_STANDARD_DATA_SEND = 0x51;
const CI_OBSERVED_REFRESH = 0xa6;
const CI_UNLOCK = 0xa5;
const CI_MANUFACTURER = 0xa9;
const CUSTOMER_ID_WIDTH = 10;

export interface GasConfiguration { x10: boolean; correctedVolume: boolean; }

export function buildObservedRefreshCommand(targetAddress: number): number[] {
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_OBSERVED_REFRESH });
}

export const buildCybleInfoRequest = buildObservedRefreshCommand;

export function buildCybleUnlockFrame(targetAddress: number, crc: number): number[] {
  if (!Number.isInteger(crc) || crc < 0 || crc > 0xffff) throw new Error("Cyble unlock CRC must be an unsigned 16-bit value.");
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_UNLOCK, data: [0x80, 0x00, crc & 0xff, (crc >>> 8) & 0xff] });
}

export function encodeCustomerId(value: string): number[] {
  // CONFIRMED: right-aligned 10-byte ASCII digit field, space padding, then ten NUL bytes.
  if (!/^\d{1,10}$/.test(value)) throw new Error("Customer ID must contain 1 to 10 ASCII digits.");
  return [...value.padStart(CUSTOMER_ID_WIDTH, " ")].map((character) => character.charCodeAt(0)).concat(new Array(10).fill(0));
}

export function buildCustomerIdCommand(targetAddress: number, customerId: string): number[] {
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x01, 0x01, ...encodeCustomerId(customerId)] });
}

export function encodeSecondaryAddressBcd(value: string): number[] {
  if (!/^\d{8}$/.test(value)) throw new Error("Secondary address must contain exactly 8 decimal digits.");
  const bytes: number[] = [];
  for (let index = value.length; index > 0; index -= 2) {
    const highDigit = Number(value[index - 2]);
    const lowDigit = Number(value[index - 1]);
    bytes.push((highDigit << 4) | lowDigit);
  }
  return bytes;
}

export function buildSecondaryAddressCommand(targetAddress: number, secondaryAddress: string): number[] {
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_STANDARD_DATA_SEND, data: [0x0c, 0x79, ...encodeSecondaryAddressBcd(secondaryAddress)] });
}

export function buildCybleVolumeCommand(targetAddress: number, rawVolume: number, vif: number): number[] {
  if (!Number.isSafeInteger(rawVolume) || rawVolume < 0 || rawVolume > 0xff_ffff) throw new Error("Raw volume exceeds the confirmed 24-bit value field.");
  const rawLittleEndian = [rawVolume & 0xff, Math.floor(rawVolume / 0x100) & 0xff, Math.floor(rawVolume / 0x1_0000) & 0xff, Math.floor(rawVolume / 0x1_000000) & 0xff];
  // CONFIRMED field order from the real write: a leading 00 followed by the
  // three little-endian value bytes. A non-zero fourth value byte is UNKNOWN.
  const observedRawField = [0x00, rawLittleEndian[0], rawLittleEndian[1], rawLittleEndian[2]];
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x02, 0x06, ...observedRawField, 0x00, vif] });
}

export function buildCyblePulseWeightWrite(targetAddress: number, pulseWeight: string | number): number[] {
  const resolutionCode = deriveCybleResolutionCodeFromPulseWeight(pulseWeight);
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x01, 0x00, resolutionCode] });
}

export function buildCybleMediumCommand(targetAddress: number, mediumCode: number): number[] {
  if (!cybleMediumOptions.some((option) => option.code === mediumCode)) throw new Error("Medium is not available in the Itron Cyble M-Bus V2 profile.");
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x01, 0x0a, mediumCode] });
}

export function buildGasRemoveX10Command(targetAddress: number): number[] {
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x02, 0x00, 0x0e, 0x14, 0x03] });
}

export function buildGasCorrectedVolumeWithX10Command(targetAddress: number): number[] {
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x02, 0x0e, 0x00, 0x00, 0x15] });
}

export function buildGasMediumWithX10Command(targetAddress: number): number[] {
  return buildLongFrame({ control: CONTROL_SND_UD, address: targetAddress, ci: CI_MANUFACTURER, data: [0x04, 0x0a, 0x06, 0x00, 0x0e, 0x03, 0x00, 0x00, 0x00, 0x00, 0x15, 0x01] });
}

export function buildCybleConfigurationPlan(configuration: DeviceConfiguration, currentAddress: number): ConfigurationPlan {
  const changes = changedFields(configuration);
  const operations: ConfigurationPlanOperation[] = [];
  const unsupported: ConfigurationPlan["unsupported"] = [];

  planMediumAndGas(configuration, changes, currentAddress, operations, unsupported);

  const volume = changes.find((item) => item.id === "volume");
  const pulseWeight = changes.find((item) => item.id === "pulseWeight");
  let volumeEncoding: ReturnType<typeof deriveCybleVolumeEncoding> | undefined;
  if (volume) {
    try {
      volumeEncoding = deriveCybleVolumeEncoding(String(volume.requestedValue ?? ""));
      operations.push(operation(volume, "manufacturerFrame", currentAddress, buildCybleVolumeCommand(currentAddress, volumeEncoding.raw, volumeEncoding.vif)));
    } catch (error) { unsupported.push(unknown(volume.id, error)); }
  }

  if (pulseWeight) {
    try {
      deriveCybleResolutionCodeFromPulseWeight(String(pulseWeight.requestedValue ?? ""));
      if (volumeEncoding && !sameCyblePulseWeight(volumeEncoding.resolution, pulseWeight.requestedValue)) {
        unsupported.push({ parameter: pulseWeight.id, reason: `Pulse weight ${String(pulseWeight.requestedValue)} is inconsistent with the ${volumeEncoding.resolution} m³ volume resolution.`, confidence: "UNKNOWN" });
      } else if (!volumeEncoding) {
        operations.push(operation(pulseWeight, "manufacturerFrame", currentAddress, buildCyblePulseWeightWrite(currentAddress, String(pulseWeight.requestedValue))));
      }
    } catch (error) { unsupported.push(unknown(pulseWeight.id, error)); }
  }

  const customer = changes.find((item) => item.id === "customerId");
  if (customer) {
    try { operations.push(operation(customer, "manufacturerFrame", currentAddress, buildCustomerIdCommand(currentAddress, String(customer.requestedValue)))); }
    catch (error) { unsupported.push(unknown(customer.id, error)); }
  }

  const secondary = changes.find((item) => item.id === "secondaryId");
  if (secondary) {
    try { operations.push(operation(secondary, "manufacturerFrame", currentAddress, buildSecondaryAddressCommand(currentAddress, String(secondary.requestedValue)))); }
    catch (error) { unsupported.push(unknown(secondary.id, error)); }
  }

  const primary = changes.find((item) => item.id === "primaryAddress");
  if (primary) operations.push(operation(primary, "primaryAddress", currentAddress));

  return { preparation: operations.length ? "cybleUnlockTotal" : undefined, operations, unsupported };
}

function planMediumAndGas(configuration: DeviceConfiguration, changes: ConfigurationField[], address: number, operations: ConfigurationPlanOperation[], unsupported: ConfigurationPlan["unsupported"]): void {
  const medium = changes.find((item) => item.id === "medium");
  const requestedMedium = Number(field(configuration, "medium")?.requestedValue);
  const gasChanged = changes.some((item) => item.id === "pulseWeightX10" || item.id === "correctedVolume");
  const transitioningToGas = Boolean(medium && requestedMedium === MBUS_MEDIUM_GAS);
  const x10 = field(configuration, "pulseWeightX10");
  const corrected = field(configuration, "correctedVolume");
  const requested: GasConfiguration = {
    x10: typeof x10?.requestedValue === "boolean" ? x10.requestedValue : false,
    correctedVolume: typeof corrected?.requestedValue === "boolean" ? corrected.requestedValue : false,
  };
  const effectiveX10 = x10 ? { ...x10, currentValue: typeof x10.currentValue === "boolean" ? x10.currentValue : false, requestedValue: requested.x10 } : medium!;

  if (transitioningToGas && requested.x10 && !requested.correctedVolume) {
    operations.push(operation(medium!, "manufacturerFrame", address, buildGasMediumWithX10Command(address), "medium,gasConfiguration"));
    return;
  }

  if (medium) {
    try { operations.push(operation(medium, "manufacturerFrame", address, buildCybleMediumCommand(address, requestedMedium))); }
    catch (error) { unsupported.push(unknown(medium.id, error)); return; }
  }

  if (requestedMedium !== MBUS_MEDIUM_GAS) {
    return;
  }

  if (!gasChanged && !transitioningToGas) return;
  if (requested.x10 && requested.correctedVolume) {
    operations.push(operation(effectiveX10, "manufacturerFrame", address, buildGasCorrectedVolumeWithX10Command(address), "gasConfiguration"));
    return;
  }
  if (!requested.x10 && !requested.correctedVolume && (transitioningToGas || (typeof corrected?.currentValue === "boolean" && sameValue(requested.correctedVolume, corrected.currentValue)))) {
    operations.push(operation(effectiveX10, "manufacturerFrame", address, buildGasRemoveX10Command(address), "gasConfiguration"));
    return;
  }
  unsupported.push({ parameter: "gasConfiguration", reason: "Configuration combination not supported by this device profile.", confidence: "UNKNOWN" });
}

function operation(field: ConfigurationField, kind: ConfigurationPlanOperation["kind"], targetAddress: number, frame?: number[], parameter = field.id): ConfigurationPlanOperation {
  return { parameter, label: field.label, previousValue: field.currentValue, requestedValue: field.requestedValue, kind, targetAddress, frame, confidence: "CONFIRMED" };
}

function unknown(parameter: string, error: unknown): ConfigurationPlan["unsupported"][number] { return { parameter, reason: error instanceof Error ? error.message : String(error), confidence: "UNKNOWN" }; }
function field(configuration: DeviceConfiguration, id: string): ConfigurationField | undefined { return configuration.fields.find((item) => item.id === id); }
