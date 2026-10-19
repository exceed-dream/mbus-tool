import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Panel({ title, description, action, children, className = "", collapsible = false, defaultExpanded = true }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string; collapsible?: boolean; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const heading = <div><h2>{title}</h2>{description && <p>{description}</p>}</div>;
  return <section className={`panel ${className}`}>{(title || action) && (collapsible
    ? <button type="button" className="panel__header panel__header--toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{heading}<Icon name={expanded ? "chevron-down" : "chevron"}/></button>
    : <div className="panel__header">{heading}{action}</div>)}<div className="panel__body" hidden={collapsible && !expanded}>{children}</div></section>;
}
