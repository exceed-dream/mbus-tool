import type { ConfigurationVerificationResult, ConfigurationWriteResult, DeviceConfiguration, TechnicalTelegram } from "../../domain/configuration/DeviceConfiguration";
import type { DeviceProtocolAdapter } from "../../domain/devices/DeviceProtocolAdapter";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { ScanObserver } from "../../domain/mbus/MbusClient";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export class DeviceProtocolAdapterRegistry implements DeviceProtocolAdapter {
  readonly id = "device-protocol-registry";

  constructor(private readonly standard: DeviceProtocolAdapter, private readonly padPuls: DeviceProtocolAdapter, private readonly cyble: DeviceProtocolAdapter) {}

  identify(device: MbusDevice, profiles: DeviceProfile[]) { return this.standard.identify(device, profiles); }

  configurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration | undefined {
    return this.forProfile(profile).configurationFromSnapshot(device, profile);
  }

  readConfiguration(device: MbusDevice, profile: DeviceProfile | undefined, observer?: ScanObserver): Promise<DeviceConfiguration> {
    return this.forProfile(profile).readConfiguration(device, profile, observer);
  }

  validateConfiguration(configuration: DeviceConfiguration) { return this.forConfiguration(configuration).validateConfiguration(configuration); }

  previewConfiguration(device: MbusDevice, configuration: DeviceConfiguration): Promise<TechnicalTelegram | undefined> {
    return this.forConfiguration(configuration).previewConfiguration(device, configuration);
  }

  writeConfiguration(device: MbusDevice, configuration: DeviceConfiguration, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    return this.forConfiguration(configuration).writeConfiguration(device, configuration, observer);
  }

  verifyConfiguration(expected: DeviceConfiguration, actual: DeviceConfiguration): ConfigurationVerificationResult {
    return this.forConfiguration(expected).verifyConfiguration(expected, actual);
  }

  private forProfile(profile: DeviceProfile | undefined) { return profile?.id === "relay-padpuls-m1" ? this.padPuls : profile?.id === "itron-cyble-mbus-v2" ? this.cyble : this.standard; }
  private forConfiguration(configuration: DeviceConfiguration) { return configuration.profileId === "relay-padpuls-m1" ? this.padPuls : configuration.profileId === "itron-cyble-mbus-v2" ? this.cyble : this.standard; }
}
