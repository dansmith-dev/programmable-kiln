// Small inline SVG icons

export function Flame({ className, size = 26 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4d1f" />
          <stop offset="0.6" stopColor="#ff8a2f" />
          <stop offset="1" stopColor="#ffd06b" />
        </linearGradient>
      </defs>
      <path d="M16 2.5c2.2 5.2 8.5 8.4 8.5 15.6a8.5 8.5 0 0 1-17 0c0-4.3 2.2-6.6 4.3-8.6 0 3.2 1.1 5.3 3.2 5.4-1.1-5.3.1-9.4 1-12.4z" fill="url(#flameGrad)" />
      <path d="M16 18c1.2 2 3.2 3 3.2 5.4a3.2 3.2 0 0 1-6.4 0c0-1.6 1-2.8 1.8-3.4.1 1.1.6 1.8 1.4 1.8-.2-1.6-.1-2.8 0-3.8z" fill="#ffe7b0" />
    </svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

export const Up = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" {...stroke} /></svg>
);

export const Down = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" {...stroke} /></svg>
);

export const Trash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" {...stroke} strokeWidth={1.8} />
  </svg>
);

export const Dots = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="19" cy="12" r="1.8" fill="currentColor" />
  </svg>
);

export const Heat = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 20c-2-3 2-5 0-8s2-5 0-8M16 20c-2-3 2-5 0-8s2-5 0-8" {...stroke} />
  </svg>
);

export const Alert = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none", marginTop: 1 }}>
    <path d="M12 3l10 18H2L12 3z" {...stroke} />
    <path d="M12 10v5M12 18v.5" {...stroke} />
  </svg>
);
