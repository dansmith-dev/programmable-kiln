import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { parseProgram } from "./kiln.js";

// Polls the kiln every 2 seconds (10 when the tab is hidden) and keeps the
// program up to date.
export function useKiln(enabled) {
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(null);
  const [program, setProgram] = useState({ version: -1, steps: [] });
  const track = useRef({ programVersion: -1 });

  const loadProgram = useCallback(async () => {
    try {
      const p = parseProgram(await api("/api/program"));
      track.current.programVersion = p.version;
      setProgram(p);
    } catch {}
  }, []);

  // Also used with the status the kiln sends back after Start / Stop
  const applyStatus = useCallback(
    (s) => {
      const t = track.current;
      setStatus(s);
      if (s.programVersion !== t.programVersion) loadProgram();
    },
    [loadProgram]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    track.current = { programVersion: -1 };
    let stopped = false;
    let inFlight = false;
    let timer = 0;

    const poll = async () => {
      clearTimeout(timer);
      inFlight = true;
      try {
        const s = await api("/api/status");
        if (stopped) return;
        setConnected(true);
        applyStatus(s);
      } catch {
        if (!stopped) setConnected(false);
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 10000 : 2000);
    };
    const onVisible = () => {
      if (!document.hidden && !inFlight) poll();
    };

    poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, applyStatus]);

  return { status, connected, program, applyStatus };
}
