import { completeSecondaryIdentityKey, type MbusDevice, type MbusSecondaryAddress } from "../../domain/mbus/MbusDevice.ts";

export interface MbusDeviceListItem extends MbusDevice {
  listKey: string;
  previousPrimaryAddress?: number;
}

export interface UpsertMbusDeviceOptions {
  replaces?: MbusDevice;
  showPrimaryAddressChange?: boolean;
}

export function upsertMbusDevices(current: MbusDeviceListItem[], incoming: MbusDevice[], options: UpsertMbusDeviceOptions = {}): MbusDeviceListItem[] {
  const merged = [...current];
  for (const device of incoming) {
    const replacementIndex = options.replaces ? merged.findIndex((candidate) => sameMbusDevice(candidate, options.replaces!)) : -1;
    const index = replacementIndex >= 0 ? replacementIndex : merged.findIndex((candidate) => sameMbusDevice(candidate, device));
    if (index < 0) {
      merged.push({ ...device, primaryAddress: validPrimaryAddress(device.primaryAddress), listKey: stableMbusDeviceKey(device) });
      continue;
    }

    const existing = merged[index];
    const incomingPrimaryAddress = validPrimaryAddress(device.primaryAddress);
    const previousPrimaryAddress = options.showPrimaryAddressChange
      && existing.primaryAddress !== undefined
      && incomingPrimaryAddress !== undefined
      && existing.primaryAddress !== incomingPrimaryAddress
      ? existing.primaryAddress
      : undefined;
    merged[index] = {
      ...existing,
      ...definedDeviceProperties(device),
      id: device.id,
      listKey: existing.listKey,
      primaryAddress: incomingPrimaryAddress ?? existing.primaryAddress,
      secondaryAddress: device.secondaryAddress ?? existing.secondaryAddress,
      previousPrimaryAddress,
    };
  }
  return merged;
}

export function sameMbusDevice(left: MbusDevice, right: MbusDevice): boolean {
  if (left.secondaryAddress && right.secondaryAddress) return sameCompleteSecondaryIdentity(left.secondaryAddress, right.secondaryAddress);

  const leftIdentification = identificationNumber(left);
  const rightIdentification = identificationNumber(right);
  if (leftIdentification && rightIdentification) {
    return leftIdentification === rightIdentification && sameKnownManufacturer(left, right);
  }

  if (leftIdentification || rightIdentification) return false;
  return left.primaryAddress !== undefined && left.primaryAddress === right.primaryAddress;
}

function validPrimaryAddress(address?: number): number | undefined {
  return Number.isInteger(address) && address! >= 0 && address! <= 250 ? address : undefined;
}

function definedDeviceProperties(device: MbusDevice): Partial<MbusDevice> {
  return Object.fromEntries(Object.entries(device).filter(([, value]) => value !== undefined)) as Partial<MbusDevice>;
}

export function stableMbusDeviceKey(device: MbusDevice): string {
  if (device.secondaryAddress) {
    const identity = device.secondaryAddress;
    return `secondary-${identity.identificationNumber}-${identity.manufacturerRaw}-${identity.version}-${identity.medium}`;
  }
  const identification = identificationNumber(device);
  if (identification) return `identified-${identification}-${device.manufacturerRaw ?? normalize(device.manufacturer)}`;
  return device.id || `primary-${device.primaryAddress ?? "unknown"}`;
}

export function withoutDeviceListMetadata(device: MbusDeviceListItem): MbusDevice {
  const { listKey: _listKey, previousPrimaryAddress: _previousPrimaryAddress, ...mbusDevice } = device;
  return mbusDevice;
}

export function completePrimaryAddresses(current: MbusDeviceListItem[], matches: MbusDevice[]): MbusDeviceListItem[] {
  const addressByIdentity = new Map(
    matches.flatMap((device) => {
      const key = completeSecondaryIdentityKey(device);
      const address = validPrimaryAddress(device.primaryAddress);
      return key && address !== undefined ? [[key, address] as const] : [];
    }),
  );
  return current.map((device) => {
    const key = completeSecondaryIdentityKey(device);
    const address = key ? addressByIdentity.get(key) : undefined;
    return device.primaryAddress === undefined && address !== undefined
      ? { ...device, primaryAddress: address }
      : device;
  });
}

function sameCompleteSecondaryIdentity(left: MbusSecondaryAddress, right: MbusSecondaryAddress): boolean {
  return left.identificationNumber === right.identificationNumber
    && left.manufacturerRaw === right.manufacturerRaw
    && left.version === right.version
    && left.medium === right.medium;
}

function identificationNumber(device: MbusDevice): string | undefined {
  return device.secondaryAddress?.identificationNumber ?? device.identificationNumber;
}

function sameKnownManufacturer(left: MbusDevice, right: MbusDevice): boolean {
  const leftRaw = left.secondaryAddress?.manufacturerRaw ?? left.manufacturerRaw;
  const rightRaw = right.secondaryAddress?.manufacturerRaw ?? right.manufacturerRaw;
  if (leftRaw !== undefined && rightRaw !== undefined) return leftRaw === rightRaw;
  const leftName = normalize(left.manufacturer);
  const rightName = normalize(right.manufacturer);
  return Boolean(leftName && rightName && leftName === rightName);
}

function normalize(value?: string): string | undefined {
  return value?.trim().toUpperCase() || undefined;
}
