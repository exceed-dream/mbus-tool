export type IconName = "network" | "library" | "settings" | "device" | "search" | "usb" | "chevron" | "chevron-left" | "chevron-down" | "arrow" | "sliders" | "refresh" | "stop" | "check" | "activity" | "edit" | "download" | "close";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    network: <><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M5 17v-3h14v3"/></>,
    library: <><path d="M4 4h5v16H4zM9 4h5v16H9zM16 5l4-1 3 15-4 1z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    device: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h2"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    usb: <><path d="M12 19V5M9 8l3-3 3 3M12 13 8 9H6M12 16l4-4h2"/><circle cx="5" cy="9" r="1"/><rect x="18" y="10.5" width="2.5" height="2.5" rx=".3"/><circle cx="12" cy="20" r="1.5"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    "chevron-left": <path d="m15 18-6-6 6-6"/>,
    "chevron-down": <path d="m6 9 6 6 6-6"/>,
    arrow: <><path d="m15 18-6-6 6-6"/></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    activity: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
