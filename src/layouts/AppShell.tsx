import type { ReactNode } from "react";
import type { OperationStatus } from "../domain/commissioning/OperationStatus";
import { Icon, type IconName } from "../components/Icon";
import { Breadcrumb } from "../components/Breadcrumb";
import { APP_BREADCRUMBS, parentBreadcrumbItem, type AppPage } from "./appNavigation";

export type { AppPage } from "./appNavigation";

const navGroups: { label: string; items: { page: AppPage; label: string; icon: IconName }[] }[] = [
  { label: "Network", items: [{ page: "scan", label: "Scan", icon: "network" }] },
  { label: "Devices", items: [{ page: "device-library", label: "Device Library", icon: "library" }] },
  { label: "System", items: [{ page: "settings", label: "Settings", icon: "settings" }] },
];

export function AppShell({ currentPage, connectionStatus, interfaceName, onNavigate, children }: { currentPage: AppPage; connectionStatus: OperationStatus; interfaceName: string; onNavigate: (page: AppPage) => void; children: ReactNode }) {
  const activeNav = currentPage === "device-details" || currentPage === "configuration" ? "scan" : currentPage;
  const parent = parentBreadcrumbItem(currentPage);
  const connected = connectionStatus === "connected";
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand__mark"><span>M</span></div><div><strong>M-Bus Tool</strong><small>Commissioning Suite</small></div></div>
      <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => <button className={`nav-item ${activeNav === item.page ? "nav-item--active" : ""}`} key={item.page} onClick={() => onNavigate(item.page)}><Icon name={item.icon}/><span>{item.label}</span>{activeNav === item.page && <span className="nav-marker" />}</button>)}</div>)}</nav>
      <div className="sidebar__footer"><div className="master-card"><div className="master-card__icon"><Icon name="usb" /></div><div><span>M-Bus Master</span><strong>{connected ? `${interfaceName} · Connected` : "No connection"}</strong></div><span className={`connection-dot ${connected ? "connection-dot--on" : ""}`} /></div><div className="version">Read + protected config <span>v0.1.0</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><Breadcrumb items={APP_BREADCRUMBS[currentPage]} onNavigate={onNavigate}/></header>
      <main className="content">{parent && <div className="content-back"><button type="button" className="icon-button content-back__button" title={`Back to ${parent.label}`} aria-label={`Back to ${parent.label}`} onClick={() => onNavigate(parent.target!)}><Icon name="chevron-left"/></button></div>}{children}</main>
    </div>
  </div>;
}
