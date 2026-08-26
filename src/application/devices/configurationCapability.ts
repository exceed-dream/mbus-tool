import type { DeviceProfile, DeviceProfileMatch } from "../../domain/devices/DeviceProfile";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";

export function hasEditableConfigurationFields(profile: DeviceProfile | undefined): boolean {
  return Boolean(profile?.installerFields.some((field) => field.editable && (["SUPPORTED", "LOCAL_ONLY"].includes(field.writeSupport) || profile.configurationProtocol === "ITRON_CYBLE")));
}

export function hasConfigurableProfile(match: DeviceProfileMatch): boolean {
  const profile = match.status === "known" || match.status === "possible" ? match.profile : undefined;
  return hasEditableConfigurationFields(profile);
}

export function configurationFieldIdForCurrentValue(profile: DeviceProfile | undefined, record: MbusDataRecord): string | undefined {
  const recordKey = capabilityKey(record.label);
  return profile?.installerFields.find((field) => field.editable && ["SUPPORTED", "LOCAL_ONLY"].includes(field.writeSupport) && (capabilityKey(field.label) === recordKey || capabilityKey(field.id) === recordKey))?.id;
}

function capabilityKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}
