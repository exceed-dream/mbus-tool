import { useId, type ReactNode } from "react";

export function InfoTooltip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const tooltipId = useId();
  return <span className={`info-tooltip ${className}`.trim()}><button type="button" aria-label={label} aria-describedby={tooltipId}>ⓘ</button><span id={tooltipId} role="tooltip">{children}</span></span>;
}
