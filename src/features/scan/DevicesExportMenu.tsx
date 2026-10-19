import { useEffect, useRef, useState } from "react";
import type { MbusDevicesExportFormat } from "../../application/export/MbusDevicesExportService";
import { Icon } from "../../components/Icon";
import { canExportDevices, DEVICE_EXPORT_OPTIONS } from "./devicesExportPresentation";

export function DevicesExportMenu({ deviceCount, onExport }: { deviceCount: number; onExport: (format: MbusDevicesExportFormat) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const enabled = canExportDevices(deviceCount);

  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div className="export-menu" ref={root}>
    <button type="button" className="button button--secondary" disabled={!enabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="download"/>Export<Icon name="chevron" size={14}/></button>
    {open && <div className="export-menu__items" role="menu" aria-label="Export format">
      {DEVICE_EXPORT_OPTIONS.map((option) => <button type="button" role="menuitem" key={option.format} onClick={() => { setOpen(false); onExport(option.format); }}><strong>{option.label}</strong><span>{option.extension}</span></button>)}
    </div>}
  </div>;
}
