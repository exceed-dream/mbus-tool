import type { DeviceProfile, DeviceProfileIdentification, DeviceProfileMatch } from "../../domain/devices/DeviceProfile";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export function matchDeviceProfile(device: MbusDevice, profiles: DeviceProfile[]): DeviceProfileMatch {
  const matches = profiles.filter((profile) => matchesIdentification(device, profile.identification));
  if (matches.length === 1) return { status: "known", profile: matches[0], matches };
  if (matches.length > 1) return { status: "ambiguous", matches };
  const possible = profiles.filter((profile) => profile.identification.manufacturerRaw !== undefined && profile.identification.manufacturerRaw === device.manufacturerRaw);
  if (possible.length === 1) return { status: "possible", profile: possible[0], matches: possible };
  if (possible.length > 1) return { status: "ambiguous", matches: possible };
  return { status: "unknown", matches: [] };
}

function matchesIdentification(device: MbusDevice, identification: DeviceProfileIdentification): boolean {
  const criteria = Object.values(identification).filter((value) => value !== undefined);
  if (criteria.length === 0) return false;
  if (identification.manufacturerCode && identification.manufacturerCode.toLowerCase() !== device.manufacturer?.toLowerCase()) return false;
  if (identification.manufacturerRaw !== undefined && identification.manufacturerRaw !== device.manufacturerRaw) return false;
  if (identification.medium && identification.medium !== device.medium) return false;
  if (identification.mediumRaw !== undefined && identification.mediumRaw !== device.mediumRaw) return false;
  if (identification.version && identification.version !== device.version) return false;
  if (identification.telegramSignature && identification.telegramSignature !== device.protocolHint) return false;
  if (identification.identificationPattern) {
    try {
      if (!device.identificationNumber || !new RegExp(identification.identificationPattern).test(device.identificationNumber)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
