import type { ReactNode } from "react";

export function Panel({ title, description, action, children, className = "" }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <div className="panel__header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}<div className="panel__body">{children}</div></section>;
}
