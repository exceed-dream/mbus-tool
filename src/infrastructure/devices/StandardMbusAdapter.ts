import { matchDeviceProfile } from "../../application/devices/DeviceProfileMatcher";
import type { ConfigurationFieldDefinition, ConfigurationVerificationResult, ConfigurationWriteResult, DeviceConfiguration } from "../../domain/configuration/DeviceConfiguration";
import { changedFields } from "../../domain/configuration/DeviceConfiguration";
import { validateConfiguration } from "../../domain/configuration/configurationValidation";
import type { DeviceProtocolAdapter } from "../../domain/devices/DeviceProtocolAdapter";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { MbusReadClient, MbusWriteClient, ScanObserver } from "../../domain/mbus/MbusClient";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export const standardPrimaryAddressField: ConfigurationFieldDefinition = {
  id: "primaryAddress",
  label: "Primary address",
  type: "integer",
  category: "STANDARD_MBUS",
  required: true,
  editable: true,
  minimum: 0,
  maximum: 250,
  readSupport: "SUPPORTED",
  writeSupport: "SUPPORTED",
  verificationSupport: "SUPPORTED",
};

export class StandardMbusAdapter implements DeviceProtocolAdapter {
  readonly id = "standard-mbus";

  constructor(private readonly reader: MbusReadClient, private readonly writer: MbusWriteClient) {}

  identify(device: MbusDevice, profiles: DeviceProfile[]) {
    return matchDeviceProfile(device, profiles);
  }

  configurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration {
    const definitions = profile ? profile.installerFields : [standardPrimaryAddressField];
    const fields = definitions.map((definition) => {
      const currentValue = definition.id === "primaryAddress" ? device.primaryAddress ?? null : null;
      return { ...definition, currentValue, requestedValue: currentValue };
    });
    return { deviceId: device.id, profileId: profile?.id, readAt: new Date().toISOString(), fields, device };
  }

  async readConfiguration(device: MbusDevice, profile: DeviceProfile | undefined, observer?: ScanObserver): Promise<DeviceConfiguration> {
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "CONFIG", message: "Reading current configuration", address: device.primaryAddress });
    const result = await this.reader.readDevice(device, observer);
    const configuration = this.configurationFromSnapshot(result.device, profile);
    for (const definition of configuration.fields) {
      const currentValue = definition.currentValue;
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "CONFIG", message: `${definition.label}: ${currentValue ?? "not available"}`, address: result.device.primaryAddress });
    }
    return configuration;
  }

  validateConfiguration(configuration: DeviceConfiguration) {
    return validateConfiguration(configuration);
  }

  previewConfiguration(): Promise<undefined> { return Promise.resolve(undefined); }

  async writeConfiguration(device: MbusDevice, configuration: DeviceConfiguration, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    const changes = changedFields(configuration);
    if (changes.length === 0) return { status: "Rejected", message: "No configuration changes to apply.", telegrams: [] };
    const unsupported = changes.find((field) => field.category !== "STANDARD_MBUS" || field.id !== "primaryAddress" || field.writeSupport !== "SUPPORTED");
    if (unsupported) return { status: "Unsupported", message: `${unsupported.label} write support is not implemented.`, telegrams: [] };
    if (changes.length !== 1) return { status: "Unsupported", message: "This adapter can write only one documented standard field at a time.", telegrams: [] };
    const primaryAddress = changes[0];
    if (device.primaryAddress === undefined || !device.secondaryAddress) {
      return { status: "Unsupported", message: "A known current primary address and complete secondary identity are required.", telegrams: [] };
    }
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "CONFIG", message: `Writing primary address: ${primaryAddress.currentValue} → ${primaryAddress.requestedValue}`, address: device.primaryAddress });
    return this.writer.writePrimaryAddress({
      currentAddress: device.primaryAddress,
      newAddress: Number(primaryAddress.requestedValue),
      secondaryAddress: device.secondaryAddress,
    }, observer);
  }

  verifyConfiguration(expected: DeviceConfiguration, actual: DeviceConfiguration): ConfigurationVerificationResult {
    const actualById = new Map(actual.fields.map((field) => [field.id, field.currentValue]));
    const fields = changedFields(expected).map((field) => ({
      fieldId: field.id,
      requestedValue: field.requestedValue,
      readBackValue: actualById.get(field.id) ?? null,
      verified: actualById.get(field.id) === field.requestedValue,
    }));
    const identityVerified = expected.deviceId === actual.deviceId;
    const verified = identityVerified && fields.length > 0 && fields.every((field) => field.verified);
    return {
      status: verified ? "Verified" : "VerificationFailed",
      message: verified ? "Configuration and secondary identity verified by read-back." : identityVerified ? "Read-back does not match the requested configuration." : "Read-back returned a different secondary identity.",
      fields,
    };
  }
}
