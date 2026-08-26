import type { DeviceConfiguration, ConfigurationValidation, ConfigurationVerificationResult, ConfigurationWriteResult } from "../configuration/DeviceConfiguration";
import type { ScanObserver } from "../mbus/MbusClient";
import type { TechnicalTelegram } from "../configuration/DeviceConfiguration";
import type { MbusDevice } from "../mbus/MbusDevice";
import type { DeviceProfile, DeviceProfileMatch } from "./DeviceProfile";

export interface DeviceProtocolAdapter {
  readonly id: string;
  identify(device: MbusDevice, profiles: DeviceProfile[]): DeviceProfileMatch;
  configurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration | undefined;
  readConfiguration(device: MbusDevice, profile: DeviceProfile | undefined, observer?: ScanObserver): Promise<DeviceConfiguration>;
  validateConfiguration(configuration: DeviceConfiguration): ConfigurationValidation;
  previewConfiguration(device: MbusDevice, configuration: DeviceConfiguration): Promise<TechnicalTelegram | undefined>;
  writeConfiguration(device: MbusDevice, configuration: DeviceConfiguration, observer?: ScanObserver): Promise<ConfigurationWriteResult>;
  verifyConfiguration(expected: DeviceConfiguration, actual: DeviceConfiguration): ConfigurationVerificationResult;
}
