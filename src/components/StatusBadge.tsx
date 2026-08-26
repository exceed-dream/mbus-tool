import type { DeviceStatus } from "../domain/mbus/MbusDevice";

export function StatusBadge({ status }: { status: DeviceStatus }) {
  return <span className={`status-badge status-badge--${status}`}><span />{status === "online" ? "Online" : status === "warning" ? "Warning" : "Offline"}</span>;
}
