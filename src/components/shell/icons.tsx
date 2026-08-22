/**
 * Original line icons drawn on a 24px grid at 1.6 stroke — deliberately not
 * lifted from any competitor's icon set (§1 brand direction).
 */
export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    gauge: (
      <>
        <path d="M4 18a8 8 0 1 1 16 0" />
        <path d="M12 18v-1" />
        <path d="m14.5 11.5-2.5 4" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3h12v18l-3-1.6-3 1.6-3-1.6L6 21Z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
    truck: (
      <>
        <path d="M3 7h10v9H3z" />
        <path d="M13 10h4l3 3v3h-7z" />
        <circle cx="7" cy="18" r="1.6" />
        <circle cx="17" cy="18" r="1.6" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 7h13a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H4Z" />
        <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H15" />
        <circle cx="16.5" cy="13" r="1.2" />
      </>
    ),
    bank: (
      <>
        <path d="m3 9 9-5 9 5" />
        <path d="M5 9v9M10 9v9M14 9v9M19 9v9" />
        <path d="M3 20h18" />
      </>
    ),
    ledger: (
      <>
        <path d="M5 4h13a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5Z" />
        <path d="M5 4v17" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </>
    ),
    leaf: (
      <>
        <path d="M12 3.5 14 8l4.5.5-3 3 1 4.5-4.5-2.2L7.5 16l1-4.5-3-3L10 8Z" />
        <path d="M12 15.8V21" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V4" />
        <path d="M4 20h16" />
        <path d="m8 15 3.5-4.5 3 2.5L20 7" />
      </>
    ),
    building: (
      <>
        <path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" />
        <path d="M14 10h4a1 1 0 0 1 1 1v10" />
        <path d="M8 8h3M8 12h3M8 16h3M17 14h0M17 18h0" />
        <path d="M3 21h18" />
      </>
    ),
    briefcase: (
      <>
        <path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
        <path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        <path d="M3 13h18" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </>
    ),
    bell: (
      <>
        <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
        <path d="M10 18a2 2 0 0 0 4 0" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 13 4 4 10-10" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    download: (
      <>
        <path d="M12 4v10" />
        <path d="m8 11 4 4 4-4" />
        <path d="M5 19h14" />
      </>
    ),
    filter: <path d="M4 6h16l-6 7v6l-4-2v-4Z" />,
    lock: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
    warning: (
      <>
        <path d="M12 4 3 20h18Z" />
        <path d="M12 10v4M12 17h0" />
      </>
    ),
    link: (
      <>
        <path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.5 7" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.1-1.1" />
      </>
    ),
    arrowUp: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
    arrowDown: <path d="M12 5v14m0 0 6-6m-6 6-6-6" />,
    logout: (
      <>
        <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
        <path d="M10 12h9m0 0-3-3m3 3-3 3" />
        <path d="M5 4v16" />
      </>
    ),
    maple: (
      <path d="M12 2.5 13.4 6l2.8-.9-.7 2.9 3.5.4-2.3 2 3.3 1.9-3 1.2 1.6 2.8-3.4-.4.1 2.9-2.6-1.5-.7 4.2-.7-4.2-2.6 1.5.1-2.9-3.4.4L7 15.5l-3-1.2L7.3 12.4l-2.3-2 3.5-.4L7.8 7l2.8.9Z" />
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16 5.5a3 3 0 0 1 0 5" />
        <path d="M18 20a6 6 0 0 0-2-4.5" />
      </>
    ),
    percent: (
      <>
        <path d="M19 5 5 19" />
        <circle cx="7.5" cy="7.5" r="2.5" />
        <circle cx="16.5" cy="16.5" r="2.5" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h3" />
      </>
    ),
    box: (
      <>
        <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2Z" />
        <path d="M4 7.2 12 11.4l8-4.2" />
        <path d="M12 11.4V21" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3l7 2.6v5.9c0 4-2.9 7.6-7 9.5-4.1-1.9-7-5.5-7-9.5V5.6Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3.5 6.5 8.5 6 8.5-6" />
      </>
    ),
    phone: (
      <path d="M6 3h3l1.5 4-2 1.5a11 11 0 0 0 5 5L15 11.5 19 13v3a2 2 0 0 1-2 2A14 14 0 0 1 4 5a2 2 0 0 1 2-2Z" />
    ),
    book: (
      <>
        <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5Z" />
        <path d="M8 3v18" />
        <path d="M11.5 8.5h4M11.5 12h4" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name] ?? paths.gauge}
    </svg>
  );
}
