import { useEffect, useRef, useState } from "react";
import { api, errorText, setToken } from "../api.js";
import { useUi } from "../ui.jsx";
import { Flame } from "./Icons.jsx";

const EMPTY = ["", "", "", "", "", ""];

// Ask the kiln to show a code, then type it in to get a token for this browser
export default function Pairing({ onPaired }) {
  const { toast } = useUi();
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [digits, setDigits] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxes = useRef([]);
  const code = digits.join("");

  const showingCode = expiresAt > 0;
  const secondsLeft = Math.round((expiresAt - now) / 1000);

  useEffect(() => {
    if (!showingCode) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showingCode]);

  useEffect(() => {
    if (showingCode && secondsLeft <= 0) {
      setExpiresAt(0);
      toast("The code ran out. Show a new one.", true);
    }
  }, [showingCode, secondsLeft, toast]);

  async function showCode() {
    setBusy(true);
    try {
      const r = await api("/api/pair/start", "POST", "");
      setExpiresAt(Date.now() + r.seconds * 1000);
      setNow(Date.now());
      setDigits(EMPTY);
      setError("");
      setTimeout(() => boxes.current[0]?.focus(), 0);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function connect(value) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    try {
      const r = await api("/api/pair", "POST", value);
      setToken(r.token);
      toast("Connected to your kiln");
      onPaired();
    } catch (e) {
      if (e.status === 403 && e.data?.left) {
        setError(`That code doesn't match. ${e.data.left} ${e.data.left === 1 ? "try" : "tries"} left.`);
        setDigits(EMPTY);
        boxes.current[0]?.focus();
      } else if (e.status === 403 || e.status === 410) {
        setExpiresAt(0);
        toast(e.message, true);
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  }

  // Fill boxes from position `from`, e.g. when a whole code is pasted
  function fill(from, text) {
    const next = [...digits];
    for (let k = 0; k < text.length && from + k < 6; k++) next[from + k] = text[k];
    setDigits(next);
    setError("");
    boxes.current[Math.min(5, from + text.length)]?.focus();
    if (next.join("").length === 6) connect(next.join(""));
  }

  function onDigit(i, value) {
    const typed = value.replace(/\D/g, "");
    if (typed.length > 1) {
      fill(i, typed);
      return;
    }
    const next = [...digits];
    next[i] = typed;
    setDigits(next);
    setError("");
    if (typed && i < 5) boxes.current[i + 1]?.focus();
    if (next.join("").length === 6) connect(next.join(""));
  }

  return (
    <section className="pair-wrap">
      <div className="card pair-card">
        <Flame className="flame" size={64} />
        <h1>Connect to your kiln</h1>
        <p>{showingCode ? "Type the 6-digit code shown on the kiln's screen." : "Show a code on the kiln's screen, then type it in here."}</p>

        {!showingCode ? (
          <button className="btn primary" style={{ width: "100%" }} onClick={showCode} disabled={busy}>
            Show code on kiln
          </button>
        ) : (
          <>
            <div className="code-inputs">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (boxes.current[i] = el)}
                  value={d}
                  onChange={(e) => onDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                    if (e.key === "Enter") connect(code);
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    fill(0, (e.clipboardData.getData("text") || "").replace(/\D/g, ""));
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  aria-label={`Digit ${i + 1}`}
                />
              ))}
            </div>
            <div className="pair-error">{error}</div>
            <button className="btn primary" style={{ width: "100%" }} onClick={() => connect(code)} disabled={busy || code.length !== 6}>
              Connect
            </button>
            <div className="countdown">
              Code expires in {Math.floor(Math.max(0, secondsLeft) / 60)}:{String(Math.max(0, secondsLeft) % 60).padStart(2, "0")}
            </div>
            <button className="btn ghost small" style={{ marginTop: 10 }} onClick={showCode} disabled={busy}>
              Show a new code
            </button>
          </>
        )}
      </div>
    </section>
  );
}
