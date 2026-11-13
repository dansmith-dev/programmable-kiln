import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { parseProgram } from "./kiln.js";

// Polls the kiln every 2 seconds (10 when the tab is hidden) and keeps the
// program and temperature history up to date.
export function useKiln(enabled) {
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(null);
  const [program, setProgram] = useState({ version: -1, steps: [] });
  const [history, setHistory] = useState(null);
  const [liveTail, setLiveTail] = useState([]);
  const track = useRef({ lastState: null, lastElapsed: 0, historyFetchedAt: 0, programVersion: -1 });

  const loadHistory = useCallback(async () => {
    track.current.historyFetchedAt = Date.now();
    try {
      const h = await api("/api/history");
      h.receivedAt = Date.now();
      const newest = h.receivedAt / 1000 - h.age;
      setHistory(h);
      setLiveTail((t) => t.filter((p) => p[0] > newest));
    } catch {}
  }, []);

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
      const restarted = t.lastState === "Running" && s.state === "Running" && s.elapsed < t.lastElapsed;
      const startedNow = s.state === "Running" && t.lastState !== null && t.lastState !== "Running";
      const needHistory = !t.historyFetchedAt || s.state !== t.lastState || restarted || Date.now() - t.historyFetchedAt > 60000;
      t.lastState = s.state;
      t.lastElapsed = s.elapsed;

      setLiveTail((tail) => {
        const next = [...(restarted || startedNow ? [] : tail), [Date.now() / 1000, s.temp, s.state === "Running" ? s.setpoint : -1]];
        return next.length > 120 ? next.slice(-120) : next;
      });
      setStatus(s);
      if (s.programVersion !== t.programVersion) loadProgram();
      if (needHistory) loadHistory();
    },
    [loadHistory, loadProgram]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    track.current = { lastState: null, lastElapsed: 0, historyFetchedAt: 0, programVersion: -1 };
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

  return { status, connected, program, history, liveTail, applyStatus };
}
