import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="MolViz home">
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path
          d="M9 10.5 16 15.5 23 10.5M16 15.5V23.5"
          stroke="var(--accent-ink)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="9" cy="10.5" r="3" fill="var(--accent-ink)" />
        <circle cx="23" cy="10.5" r="3" fill="var(--accent-ink)" />
        <circle cx="16" cy="23.5" r="3" fill="var(--accent-ink)" />
        <circle cx="16" cy="15.5" r="3.6" fill="var(--accent-bright)" stroke="var(--accent-ink)" strokeWidth="1.6" />
      </svg>
      <span className="logo-word">
        Mol<span>Viz</span>
      </span>
    </Link>
  );
}

// The bar across the top of every page: the logo, then page-specific actions.
export default function AppHeader({ children, wide }: { children?: ReactNode; wide?: boolean }) {
  return (
    <header className="app-header">
      <div className={wide ? "app-header-inner wide" : "app-header-inner"}>
        <Logo />
        <div className="app-header-actions">{children}</div>
      </div>
    </header>
  );
}
