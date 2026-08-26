import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";
import { cybleMediumOptions } from "../../domain/mbus/CybleConfigurationPolicy.ts";
import { cyblePulseWeightOptions } from "../../domain/mbus/CyblePulseWeight.ts";
import { mbusMediumOptions } from "../../domain/mbus/MbusMedium.ts";
import { padPulsUnitOptions } from "../../domain/mbus/MbusVif.ts";

export const mockDevices: MbusDevice[] = [
  { id: "secondary-22075482-48AC-09-01", primaryAddress: 2, secondaryAddress: { identificationNumber: "22075482", manufacturerRaw: 0x48ac, version: 9, medium: 1 }, manufacturer: "REL", manufacturerRaw: 0x48ac, model: "PadPuls M1", identificationNumber: "22075482", version: "9", medium: "Oil", mediumRaw: 1, baudRate: 2400, status: "online", lastReadAt: "Today, 10:40:00", protocolHint: "RELAY_PADPULS_M1", padPulsConfiguration: { primaryAddress: 2, secondaryId: "22075482", manufacturerRaw: 0x48ac, generation: 9, medium: 1, vif: 0x13, counter: 15, numerator: 1, denominator: 10, writeProtected: false } },
  { id: "secondary-17017649-0477-14-07", primaryAddress: 4, secondaryAddress: { identificationNumber: "17017649", manufacturerRaw: 0x0477, version: 20, medium: 7 }, manufacturer: "ACW", manufacturerRaw: 0x0477, model: "Itron Cyble M-Bus V2", identificationNumber: "17017649", fabricationNumber: "17017648", version: "20", medium: "Water", mediumRaw: 7, baudRate: 2400, status: "online", lastReadAt: "Today, 10:42:18", protocolHint: "ITRON_CYBLE_MBUS_V2", cybleConfiguration: { primaryAddress: 4, secondaryId: "17017649", customerId: "997321", medium: 7, volume: "6", volumeRaw: 600, volumeVif: 0x14, volumeResolution: "0.01", pulseWeightLitres: 10, gasConfiguration: { x10: false, correctedVolume: false } } },
  { id: "dev-18", primaryAddress: 18, secondaryAddress: { identificationNumber: "60149377", manufacturerRaw: 0x2c2d, version: 1, medium: 4 }, manufacturer: "Kamstrup", model: "MULTICAL 403", identificationNumber: "60149377", version: "1", medium: "Heat", mediumRaw: 4, baudRate: 2400, status: "online", lastReadAt: "Today, 10:42:21" },
  { id: "dev-24", primaryAddress: 24, secondaryAddress: { identificationNumber: "10582741", manufacturerRaw: 0x4cae, version: 3, medium: 4 }, manufacturer: "Sontex", model: "Supercal 739", identificationNumber: "10582741", version: "3", medium: "Heat", mediumRaw: 4, baudRate: 2400, status: "warning", lastReadAt: "Today, 10:42:25" },
  { id: "dev-31", primaryAddress: 31, secondaryAddress: { identificationNumber: "88421605", manufacturerRaw: 0x11a8, version: 1, medium: 7 }, manufacturer: "Diehl", model: "IZAR RC", identificationNumber: "88421605", version: "1", medium: "Water", mediumRaw: 7, baudRate: 300, status: "online", lastReadAt: "Today, 10:42:28" },
];

export const mockRecords: MbusDataRecord[] = [
  { id: "energy", label: "Energy", function: "Instantaneous", storageNumber: 0, unit: "kWh", value: "18,452.6", rawValue: "04 06 9A 28 00 00" },
  { id: "volume", label: "Volume", function: "Instantaneous", storageNumber: 0, unit: "m³", value: "1,245.678", rawValue: "04 13 4E 61 BC 00" },
  { id: "flow", label: "Flow", function: "Instantaneous", storageNumber: 0, unit: "m³/h", value: "0.842", rawValue: "04 3B 4A 03 00 00" },
  { id: "power", label: "Power", function: "Maximum", storageNumber: 1, unit: "kW", value: "12.4", rawValue: "02 2B D8 04" },
  { id: "temperature", label: "Temperature", function: "Instantaneous", storageNumber: 0, unit: "°C", value: "54.7", rawValue: "02 59 23 02" },
];

export const mockProfiles: DeviceProfile[] = [
  { id: "relay-padpuls-m1", manufacturer: "Relay", model: "PadPuls M1", deviceType: "1-channel pulse converter", identification: { manufacturerCode: "REL", manufacturerRaw: 0x48ac, version: "9", telegramSignature: "RELAY_PADPULS_M1" }, supportedBaudRates: [300, 2400, 9600], configurationProtocol: "RELAY", installerFields: padPulsFields(), isMock: false },
  { id: "itron-cyble-mbus-v2", manufacturer: "Itron", model: "Cyble M-Bus V2", deviceType: "Pulse M-Bus module", identification: { manufacturerCode: "ACW", manufacturerRaw: 0x0477, version: "20", telegramSignature: "ITRON_CYBLE_MBUS_V2" }, supportedBaudRates: [2400], configurationProtocol: "ITRON_CYBLE", installerFields: cybleFields(), isMock: false },
  { id: "kamstrup-multical-403", manufacturer: "Kamstrup", model: "MULTICAL 403", deviceType: "Heat meter", identification: { manufacturerCode: "Kamstrup", medium: "Heat", version: "1" }, supportedBaudRates: [300, 2400], configurationProtocol: "KAMSTRUP", installerFields: [primaryAddressField()], isMock: true },
  { id: "sontex-supercal-739", manufacturer: "Sontex", model: "Supercal 739", deviceType: "Heat calculator", identification: { manufacturerCode: "Sontex", medium: "Heat", version: "3" }, supportedBaudRates: [2400], configurationProtocol: "SONTEX", installerFields: [primaryAddressField()], isMock: true },
  { id: "generic-mbus-meter", manufacturer: "Generic", model: "EN 13757 meter", deviceType: "M-Bus device", identification: {}, supportedBaudRates: [300, 2400, 9600], configurationProtocol: "STANDARD_MBUS", installerFields: [primaryAddressField()], isMock: true },
];

function padPulsFields(): DeviceProfile["installerFields"] {
  const supported = { readSupport: "SUPPORTED" as const, writeSupport: "SUPPORTED" as const, verificationSupport: "SUPPORTED" as const };
  return [
    primaryAddressField(),
    { id: "secondaryId", label: "Secondary ID", type: "text", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, pattern: "^\\d{8}$", ...supported },
    { id: "fabricNumber", label: "Fabric. no.", type: "text", category: "LOCAL_METADATA", required: false, editable: true, readSupport: "LOCAL_ONLY", writeSupport: "LOCAL_ONLY", verificationSupport: "LOCAL_ONLY" },
    { id: "medium", label: "Medium", type: "select", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, options: mbusMediumOptions.map((option) => ({ value: option.code, label: option.label })), ...supported },
    { id: "multiplicator", label: "Multiplicator", type: "ratio", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, ...supported },
    { id: "unit", label: "Unit", type: "select", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, options: padPulsUnitOptions.map((option) => ({ value: option.vif, label: option.label })), ...supported },
    { id: "counter", label: "Counter", type: "integer", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, minimum: 0, maximum: 1099511627775, ...supported },
  ];
}

function primaryAddressField(): DeviceProfile["installerFields"][number] {
  return { id: "primaryAddress", label: "Primary address", type: "integer", category: "STANDARD_MBUS", required: true, editable: true, minimum: 0, maximum: 250, readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED" };
}

function cybleFields(): DeviceProfile["installerFields"] {
  const supported = { readSupport: "SUPPORTED" as const, writeSupport: "SUPPORTED" as const, verificationSupport: "SUPPORTED" as const };
  const unavailable = { readSupport: "NOT_IMPLEMENTED" as const, writeSupport: "NOT_IMPLEMENTED" as const, verificationSupport: "NOT_IMPLEMENTED" as const };
  return [
    primaryAddressField(),
    { id: "secondaryId", label: "Secondary address", type: "text", category: "STANDARD_MBUS", required: true, editable: true, pattern: "^\\d{8}$", ...supported },
    { id: "fabricationNumber", label: "Fabrication number", type: "text", category: "STANDARD_MBUS", required: false, editable: false, readSupport: "READ_ONLY", writeSupport: "READ_ONLY", verificationSupport: "NOT_IMPLEMENTED" },
    { id: "customerId", label: "Customer ID", type: "text", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, pattern: "^\\d{1,10}$", ...supported },
    { id: "medium", label: "Medium", type: "select", category: "STANDARD_MBUS", required: true, editable: true, options: cybleMediumOptions.map((option) => ({ value: option.code, label: option.label })), readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED" },
    { id: "volume", label: "Volume", type: "text", unit: "m³", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, ...supported },
    { id: "pulseWeight", label: "Pulse weight", type: "select", unit: "m³/p", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, options: cyblePulseWeightOptions.map((option) => ({ value: option.value, label: option.value })), readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED" },
    { id: "dateTime", label: "Date and Time", type: "text", category: "MANUFACTURER_SPECIFIC", required: false, editable: false, ...unavailable },
    { id: "correctedVolume", label: "Corrected Volume", type: "boolean", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, readSupport: "NOT_IMPLEMENTED", writeSupport: "SUPPORTED", verificationSupport: "NOT_IMPLEMENTED" },
    { id: "pulseWeightX10", label: "Pulse weight ×10", type: "boolean", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, readSupport: "NOT_IMPLEMENTED", writeSupport: "SUPPORTED", verificationSupport: "NOT_IMPLEMENTED" },
    { id: "alarmReset", label: "Alarm reset", type: "boolean", category: "MANUFACTURER_SPECIFIC", required: false, editable: false, kind: "ACTION", ...unavailable },
  ];
}
