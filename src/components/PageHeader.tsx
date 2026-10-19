import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";

export function PageHeader({ eyebrow, title, description, titleInfo, actions }: { eyebrow?: string; title: string; description?: string; titleInfo?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<div className="page-header__title-row"><h1>{title}</h1>{titleInfo && <InfoTooltip label={`About ${title}`} className="page-title-info">{titleInfo}</InfoTooltip>}</div>{description && <p>{description}</p>}</div>{actions && <div className="page-header__actions">{actions}</div>}</header>;
}
