import { Fragment } from "react";
import { Icon } from "./Icon";
import type { AppPage, BreadcrumbItem } from "../layouts/appNavigation";

export function Breadcrumb({ items, onNavigate }: { items: readonly BreadcrumbItem[]; onNavigate: (page: AppPage) => void }) {
  return <nav className="breadcrumb" aria-label="Breadcrumb">{items.map((item, index) => <Fragment key={`${item.label}-${index}`}>
    {index > 0 && <Icon name="chevron" size={14}/>} 
    {item.target ? <button type="button" onClick={() => onNavigate(item.target!)}>{item.label}</button> : <strong aria-current="page">{item.label}</strong>}
  </Fragment>)}</nav>;
}
