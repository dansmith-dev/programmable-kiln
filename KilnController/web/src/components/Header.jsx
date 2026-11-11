import { useEffect, useState } from "react";
import { Dots, Flame } from "./Icons.jsx";

export default function Header({ paired, connected, onDisconnect }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <header>
      <div className="brand"><Flame />Kiln</div>
      <div className="spacer" />
      {paired && (
        <>
          <div className={"conn" + (connected === true ? " live" : connected === false ? " down" : "")}>
            <span className="dot" />
            <span>{connected === null ? "Connecting…" : connected ? "Live" : "Can't reach kiln"}</span>
          </div>
          <button
            className="icon-btn"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            <Dots />
          </button>
          {menuOpen && (
            <div className="menu">
              <button onClick={onDisconnect}>Disconnect this device</button>
            </div>
          )}
        </>
      )}
    </header>
  );
}
