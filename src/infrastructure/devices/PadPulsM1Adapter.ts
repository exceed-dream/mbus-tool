import { matchDeviceProfile } from "../../application/devices/DeviceProfileMatcher";
import type { ConfigurationField, ConfigurationVerificationResult, ConfigurationWriteResult, DeviceConfiguration } from "../../domain/configuration/DeviceConfiguration";
import { changedFields, sameValue } from "../../domain/configuration/DeviceConfiguration";
import { validateConfiguration } from "../../domain/configuration/configurationValidation";
import type { DeviceProtocolAdapter } from "../../domain/devices/DeviceProtocolAdapter";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { MbusReadClient, MbusWriteClient, PadPulsWriteRequest, ScanObserver } from "../../domain/mbus/MbusClient";
import type { MbusDevice, PadPulsConfiguration } from "../../domain/mbus/MbusDevice";

const localFabricNumbers = new Map<string, string>();

export class PadPulsM1Adapter implements DeviceProtocolAdapter {
  readonly id = "relay-padpuls-m1";

  constructor(private readonly reader: MbusReadClient, private readonly writer: MbusWriteClient) {}

  identify(device: MbusDevice, profiles: DeviceProfile[]) {
    return matchDeviceProfile(device, profiles);
  }

  configurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration | undefined {
    if (device.protocolHint !== "RELAY_PADPULS_M1" || !device.padPulsConfiguration) return undefined;
    const parsed = device.padPulsConfiguration;
    const values: Record<string, ConfigurationField["currentValue"]> = {
      primaryAddress: parsed.primaryAddress,
      secondaryId: parsed.secondaryId,
      fabricNumber: localFabricNumbers.get(parsed.secondaryId) ?? "",
      medium: parsed.medium,
      multiplicator: { numerator: parsed.numerator, denominator: parsed.denominator },
      unit: parsed.vif,
      counter: parsed.counter,
    };
    const fields = (profile?.installerFields ?? []).map((definition) => {
      const currentValue = values[definition.id] ?? null;
      return { ...definition, currentValue, requestedValue: currentValue };
    });
    return { deviceId: device.id, profileId: profile?.id, readAt: new Date().toISOString(), fields, device, writeProtected: parsed.writeProtected };
  }

  async readConfiguration(device: MbusDevice, profile: DeviceProfile | undefined, observer?: ScanObserver): Promise<DeviceConfiguration> {
    const result = await this.reader.readDevice(device, observer);
    const configuration = this.configurationFromSnapshot(result.device, profile);
    if (!configuration) throw new Error("The response is not a confirmed Relay PadPuls M1 configuration.");
    return configuration;
  }

  validateConfiguration(configuration: DeviceConfiguration) {
    if (configuration.writeProtected && changedFields(configuration).some((field) => field.writeSupport === "SUPPORTED")) {
      return { valid: false, issues: [{ fieldId: "writeProtection", message: "PadPuls write protection is active; bus configuration cannot be changed." }] };
    }
    return validateConfiguration(configuration);
  }

  previewConfiguration(device: MbusDevice, configuration: DeviceConfiguration) {
    if (!changedFields(configuration).some((item) => item.writeSupport === "SUPPORTED")) return Promise.resolve(undefined);
    const validation = this.validateConfiguration(configuration);
    if (!validation.valid) return Promise.reject(new Error(validation.issues.map((issue) => issue.message).join(" ")));
    return this.writer.previewPadPulsConfiguration(toWriteRequest(device, configuration));
  }

  async writeConfiguration(device: MbusDevice, configuration: DeviceConfiguration, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    const changes = changedFields(configuration);
    if (!changes.length) return rejected("No configuration changes to apply.");
    const busChanges = changes.filter((item) => item.writeSupport === "SUPPORTED");
    if (configuration.writeProtected && busChanges.length) return rejected("Configuration locked on device.");
    const fabric = field(configuration, "fabricNumber");
    if (fabric) localFabricNumbers.set(String(requested(configuration, "secondaryId")), String(fabric.requestedValue ?? ""));
    if (!busChanges.length) return { status: "Success", message: "Local metadata saved; no M-Bus telegram was required.", telegrams: [] };
    return this.writer.writePadPulsConfiguration(toWriteRequest(device, configuration), observer);
  }

  verifyConfiguration(expected: DeviceConfiguration, actual: DeviceConfiguration): ConfigurationVerificationResult {
    const actualById = new Map(actual.fields.map((item) => [item.id, item.currentValue]));
    const fields = expected.fields.map((item) => {
      const readBackValue = actualById.get(item.id) ?? null;
      return { fieldId: item.id, requestedValue: item.requestedValue, readBackValue, verified: sameValue(item.requestedValue, readBackValue) };
    });
    const verified = fields.every((item) => item.verified);
    return { status: verified ? "Verified" : "VerificationFailed", message: verified ? "Complete PadPuls configuration verified by read-back." : "PadPuls read-back does not match the complete requested configuration.", fields };
  }
}

function field(configuration: DeviceConfiguration, id: string): ConfigurationField | undefined { return configuration.fields.find((item) => item.id === id); }
function requested(configuration: DeviceConfiguration, id: string) { return field(configuration, id)?.requestedValue ?? null; }
function toWriteRequest(device: MbusDevice, configuration: DeviceConfiguration): PadPulsWriteRequest {
  const current = requirePadPulsConfiguration(configuration.device ?? device);
  const ratio = requested(configuration, "multiplicator");
  if (typeof ratio !== "object" || ratio === null) throw new Error("Multiplicator is invalid.");
  return {
    currentAddress: current.primaryAddress,
    primaryAddress: Number(requested(configuration, "primaryAddress")),
    secondaryId: String(requested(configuration, "secondaryId")),
    manufacturerRaw: current.manufacturerRaw,
    generation: current.generation,
    medium: Number(requested(configuration, "medium")),
    vif: Number(requested(configuration, "unit")),
    counter: Number(requested(configuration, "counter")),
    numerator: ratio.numerator,
    denominator: ratio.denominator,
    writeProtected: current.writeProtected,
  };
}
function requirePadPulsConfiguration(device: MbusDevice): PadPulsConfiguration {
  if (device.protocolHint !== "RELAY_PADPULS_M1" || !device.padPulsConfiguration) throw new Error("The telegram does not contain an exact Relay PadPuls M1 configuration structure.");
  return device.padPulsConfiguration;
}
function rejected(message: string): ConfigurationWriteResult { return { status: "Rejected", message, telegrams: [] }; }
