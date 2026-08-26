import { PageHeader } from "../../components/PageHeader";
import { Panel } from "../../components/Panel";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";

export function DeviceLibraryPage({ profiles }: { profiles: DeviceProfile[] }) {
  return <div className="page"><PageHeader eyebrow="Devices" title="Device Library" description="Known device profiles used for identification and configuration." actions={<button className="button button--secondary" disabled>Import JSON</button>}/><div className="notice notice--neutral"><div><strong>Local profile catalogue</strong><p>Profiles are mocked in this foundation. JSON file loading will be added with local persistence.</p></div></div><Panel><div className="table-wrap"><table><thead><tr><th>Manufacturer</th><th>Model</th><th>Device type</th><th>Baud rates</th><th>Protocol</th><th>Source</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td className="strong">{profile.manufacturer}</td><td>{profile.model}</td><td>{profile.deviceType}</td><td>{profile.supportedBaudRates.join(", ")}</td><td><span className="protocol-chip">{profile.configurationProtocol}</span></td><td><span className="mock-label">MOCK</span></td></tr>)}</tbody></table></div></Panel></div>;
}
