import type { DeviceProfile, DeviceProfileMatch } from "../../domain/devices/DeviceProfile.ts";

export function defaultProfileForMatch(match: DeviceProfileMatch, profiles: DeviceProfile[]): DeviceProfile | undefined {
  if (match.status === "known" || match.status === "possible") return match.profile;
  if (match.status === "ambiguous") return undefined;
  return profiles.find(isGenericProfile);
}

export function applicableProfilesForMatch(match: DeviceProfileMatch, profiles: DeviceProfile[]): DeviceProfile[] {
  const candidates = match.status === "unknown" ? [] : match.matches;
  return uniqueProfiles([...candidates, ...profiles.filter(isGenericProfile)]);
}

function isGenericProfile(profile: DeviceProfile): boolean {
  return Object.values(profile.identification).every((value) => value === undefined);
}

function uniqueProfiles(profiles: DeviceProfile[]): DeviceProfile[] {
  return profiles.filter((profile, index) => profiles.findIndex((candidate) => candidate.id === profile.id) === index);
}
