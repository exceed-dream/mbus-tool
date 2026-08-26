import { matchDeviceProfile } from "../../application/devices/DeviceProfileMatcher.ts";
import type { ConfigurationField, ConfigurationValidation, ConfigurationVerificationResult, ConfigurationWriteResult, DeviceConfiguration, TechnicalTelegram } from "../../domain/configuration/DeviceConfiguration";
import { changedFields, sameValue } from "../../domain/configuration/DeviceConfiguration.ts";
import type { DeviceProtocolAdapter } from "../../domain/devices/DeviceProtocolAdapter";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { MbusReadClient, MbusWriteClient, ScanObserver } from "../../domain/mbus/MbusClient";
import type { CybleConfiguration, MbusDevice } from "../../domain/mbus/MbusDevice";
import { deriveCybleVolumeEncoding, sameCyblePhysicalVolume, type CybleVolumeEncoding } from "../../domain/mbus/CybleVolumeEncoding.ts";
import { deriveCybleResolutionCodeFromPulseWeight, sameCyblePulseWeight } from "../../domain/mbus/CyblePulseWeight.ts";
import { prepareCybleForWrite } from "../../domain/mbus/CybleUnlock.ts";
import { toHex } from "../../domain/mbus/MbusFrame.ts";
import { buildCybleConfigurationPlan, buildCybleInfoRequest, buildCybleUnlockFrame } from "./ItronCybleCommandBuilder.ts";

export class ItronCybleMbusV2Adapter implements DeviceProtocolAdapter {
  readonly id = "itron-cyble-mbus-v2";
  private readonly reader: MbusReadClient;
  private readonly writer: MbusWriteClient;

  constructor(reader: MbusReadClient, writer: MbusWriteClient) {
    this.reader = reader;
    this.writer = writer;
  }

  identify(device: MbusDevice, profiles: DeviceProfile[]) { return matchDeviceProfile(device, profiles); }

  configurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration | undefined {
    const confirmed = device.protocolHint === "ITRON_CYBLE_MBUS_V2" && device.cybleConfiguration;
    const manuallySelectedCandidate = profile?.id === "itron-cyble-mbus-v2" && device.manufacturerRaw === 0x0477 && device.version === "20";
    if (!confirmed && !manuallySelectedCandidate) return undefined;
    const parsed = device.cybleConfiguration;
    const values: Record<string, ConfigurationField["currentValue"]> = {
      primaryAddress: parsed?.primaryAddress ?? device.primaryAddress ?? null,
      secondaryId: parsed?.secondaryId ?? device.identificationNumber ?? null,
      fabricationNumber: device.fabricationNumber ?? null,
      customerId: parsed?.customerId ?? null,
      medium: parsed?.medium ?? device.mediumRaw ?? null,
      volume: parsed?.volume ?? null,
      pulseWeight: parsed?.volumeResolution ?? null,
      pulseWeightX10: parsed?.gasConfiguration?.x10 ?? false,
      correctedVolume: parsed?.gasConfiguration?.correctedVolume ?? false,
    };
    const fields = (profile?.installerFields ?? []).map((definition) => {
      const currentValue = values[definition.id] ?? null;
      return { ...definition, currentValue, requestedValue: currentValue };
    });
    return { deviceId: device.id, profileId: profile?.id, readAt: new Date().toISOString(), fields, device };
  }

  async readConfiguration(device: MbusDevice, profile: DeviceProfile | undefined, observer?: ScanObserver): Promise<DeviceConfiguration> {
    const result = await this.reader.readDevice(device, observer);
    const configuration = this.configurationFromSnapshot(result.device, profile);
    if (!configuration) throw new Error("The response is neither a confirmed nor a manually selected Itron Cyble M-Bus V2 candidate.");
    return configuration;
  }

  validateConfiguration(configuration: DeviceConfiguration): ConfigurationValidation {
    const basicIssues = changedFields(configuration).flatMap((field) => {
      if (!field.editable) return [{ fieldId: field.id, message: `${field.label} is not editable.` }];
      if (field.id === "primaryAddress") {
        const value = Number(field.requestedValue);
        return Number.isInteger(value) && value >= 0 && value <= 250 ? [] : [{ fieldId: field.id, message: "Primary address must be an integer from 0 to 250." }];
      }
      if (field.id === "customerId" && (typeof field.requestedValue !== "string" || !/^\d{1,10}$/.test(field.requestedValue))) return [{ fieldId: field.id, message: "Customer ID must contain 1 to 10 ASCII digits (the only confirmed character set)." }];
      if (field.id === "secondaryId" && (typeof field.requestedValue !== "string" || !/^\d{8}$/.test(field.requestedValue))) return [{ fieldId: field.id, message: "Secondary address must contain exactly 8 digits." }];
      if (field.id === "volume") {
        try { deriveCybleVolumeEncoding(String(field.requestedValue ?? "")); return []; }
        catch (error) { return [{ fieldId: field.id, message: error instanceof Error ? error.message : "Invalid volume." }]; }
      }
      if (field.id === "pulseWeight") {
        try { deriveCybleResolutionCodeFromPulseWeight(String(field.requestedValue ?? "")); return []; }
        catch (error) { return [{ fieldId: field.id, message: error instanceof Error ? error.message : "Invalid Pulse weight." }]; }
      }
      if (field.id === "medium" && !field.options?.some((option) => option.value === field.requestedValue)) return [{ fieldId: field.id, message: "Medium has an invalid option." }];
      return [];
    });
    const address = Number(configuration.fields.find((field) => field.id === "primaryAddress")?.currentValue);
    const plan = Number.isInteger(address) ? buildCybleConfigurationPlan(configuration, address) : { operations: [], unsupported: [{ parameter: "primaryAddress", reason: "Current primary address is unavailable.", confidence: "UNKNOWN" as const }] };
    const planIssues = plan.unsupported.map((item) => ({ fieldId: item.parameter, message: item.reason }));
    return { valid: basicIssues.length + planIssues.length === 0, issues: [...basicIssues, ...planIssues] };
  }

  previewConfiguration(device: MbusDevice, configuration: DeviceConfiguration): Promise<TechnicalTelegram | undefined> {
    if (device.primaryAddress === undefined) return Promise.resolve(undefined);
    const plan = buildCybleConfigurationPlan(configuration, device.primaryAddress);
    const command = plan.operations.find((operation) => operation.frame);
    return Promise.resolve(command?.frame ? { timestamp: new Date().toISOString(), direction: "TX", operation: command.label, primaryAddress: command.targetAddress, rawTelegram: toHex(command.frame), parsedResult: `${plan.operations.length} confirmed operation(s) planned · preview only` } : undefined);
  }

  async writeConfiguration(device: MbusDevice, configuration: DeviceConfiguration, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    const currentAddress = device.primaryAddress;
    if (currentAddress === undefined) return unsupported("A known current primary address is required.");
    const plan = buildCybleConfigurationPlan(configuration, currentAddress);
    if (plan.unsupported.length) return unsupported(plan.unsupported.map((item) => `${item.parameter}: ${item.reason}`).join(" "));
    if (!plan.operations.length) return { status: "Rejected", message: "No configuration changes to apply.", telegrams: [] };
    const telegrams: TechnicalTelegram[] = [];
    if (plan.preparation === "cybleUnlockTotal") {
      const preparation = await prepareCybleForWrite(this.writer, currentAddress, buildCybleInfoRequest(currentAddress), (crc) => buildCybleUnlockFrame(currentAddress, crc), observer);
      telegrams.push(...preparation.telegrams);
      if (preparation.status !== "Success") return { ...preparation, telegrams };
    }
    let activeDevice = device;
    for (const operation of plan.operations) {
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "CONFIG", message: `Writing ${operation.label}`, address: activeDevice.primaryAddress });
      const result = operation.kind === "primaryAddress"
        ? await this.writePrimaryAddress(activeDevice, Number(operation.requestedValue), observer)
        : await this.writer.sendFrameAndWaitForAck({ targetAddress: operation.targetAddress, operation: operation.label, frame: operation.frame ?? [] }, observer);
      telegrams.push(...result.telegrams);
      if (result.status !== "Success") return { ...result, telegrams };
      activeDevice = deviceAfterAcknowledgedOperation(activeDevice, operation.parameter, operation.requestedValue);
    }
    return { status: "Success", message: `Cyble unlock and ${plan.operations.length} configuration command(s) acknowledged; read-back required.`, telegrams };
  }

  verifyConfiguration(expected: DeviceConfiguration, actual: DeviceConfiguration): ConfigurationVerificationResult {
    const actualById = new Map(actual.fields.map((field) => [field.id, field.currentValue]));
    const changes = changedFields(expected);
    const fields = changes.map((field) => {
      const readBackAvailable = field.verificationSupport === "SUPPORTED";
      const readBackValue = readBackAvailable ? actualById.get(field.id) ?? null : null;
      const verified = readBackAvailable && (field.id === "volume" ? sameCyblePhysicalVolume(String(field.requestedValue), String(readBackValue)) : field.id === "pulseWeight" ? sameCyblePulseWeight(field.requestedValue, readBackValue) : field.id === "customerId" ? sameCybleCustomerId(field.requestedValue, readBackValue) : sameValue(field.requestedValue, readBackValue));
      return { fieldId: field.id, requestedValue: field.requestedValue, readBackValue, verified };
    });
    const volume = changes.find((field) => field.id === "volume");
    if (volume && !changes.some((field) => field.id === "pulseWeight")) {
      const requestedValue = deriveCybleVolumeEncoding(String(volume.requestedValue)).resolution;
      const readBackValue = actualById.get("pulseWeight") ?? null;
      fields.push({ fieldId: "pulseWeight", requestedValue, readBackValue, verified: sameCyblePulseWeight(requestedValue, readBackValue) });
    }
    const transitioningToGas = changes.some((field) => field.id === "medium" && field.requestedValue === 0x03);
    if (transitioningToGas) {
      for (const fieldId of ["pulseWeightX10", "correctedVolume"]) {
        if (fields.some((field) => field.fieldId === fieldId)) continue;
        const expectedField = expected.fields.find((field) => field.id === fieldId);
        fields.push({ fieldId, requestedValue: typeof expectedField?.requestedValue === "boolean" ? expectedField.requestedValue : false, readBackValue: null, verified: false });
      }
    }
    const verified = fields.length > 0 && fields.every((field) => field.verified);
    const readBackUnavailable = fields.some((field) => field.readBackValue === null);
    return { status: verified ? "Verified" : "VerificationFailed", message: verified ? "All requested values were verified by read-back." : readBackUnavailable ? "Read-back is unavailable for one or more requested fields." : "Read-back does not match every requested value.", fields };
  }

  private writePrimaryAddress(device: MbusDevice, newAddress: number, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    if (device.primaryAddress === undefined || !device.secondaryAddress) return Promise.resolve(unsupported("Primary-address change requires the complete secondary identity."));
    return this.writer.writePrimaryAddress({ currentAddress: device.primaryAddress, newAddress, secondaryAddress: device.secondaryAddress }, observer);
  }
}

function unsupported(message: string): ConfigurationWriteResult { return { status: "Unsupported", message, telegrams: [] }; }

function sameCybleCustomerId(left: ConfigurationField["requestedValue"], right: ConfigurationField["currentValue"]): boolean {
  const normalize = (value: ConfigurationField["currentValue"]) => String(value ?? "").replace(/^ +| +$/g, "");
  return normalize(left) === normalize(right);
}

function deviceAfterAcknowledgedOperation(device: MbusDevice, parameter: string, requestedValue: ConfigurationField["requestedValue"]): MbusDevice {
  if (parameter === "secondaryId") {
    const identificationNumber = String(requestedValue);
    return { ...device, identificationNumber, secondaryAddress: device.secondaryAddress ? { ...device.secondaryAddress, identificationNumber } : undefined };
  }
  if (parameter.startsWith("medium")) {
    const medium = Number(requestedValue);
    return { ...device, mediumRaw: medium, secondaryAddress: device.secondaryAddress ? { ...device.secondaryAddress, medium } : undefined };
  }
  if (parameter === "primaryAddress") return { ...device, primaryAddress: Number(requestedValue) };
  return device;
}

export function cybleEncodingFromDevice(configuration: CybleConfiguration): CybleVolumeEncoding {
  return { normalized: configuration.volume, raw: configuration.volumeRaw, resolution: configuration.volumeResolution, vif: configuration.volumeVif, pulseWeightLitres: configuration.pulseWeightLitres };
}
