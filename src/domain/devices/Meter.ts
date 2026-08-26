export interface Meter {
  id: string;
  manufacturer: string;
  model: string;
  serialNumber?: string;
  medium: string;
}

export interface CommunicationModule {
  id: string;
  manufacturer: string;
  model: string;
  profileId?: string;
  attachedMeterId?: string;
}
