import type { DeviceProfile, DeviceProfileRepository } from "../../domain/devices/DeviceProfile";
import { mockProfiles } from "../mbus/mockData";

export class MockDeviceRepository implements DeviceProfileRepository {
  getAll(): DeviceProfile[] {
    return mockProfiles.map((profile) => ({ ...profile }));
  }

  findById(id: string): DeviceProfile | undefined {
    return this.getAll().find((profile) => profile.id === id);
  }
}
