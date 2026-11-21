import { useEffect, useRef, useState } from "react";
import { api, errorText, setToken } from "../api.js";
import { useUi } from "../ui.jsx";
import { Flame } from "./Icons.jsx";

// Ask the kiln to show a code, then type it in to get a token for this browser
export default function Pairing({ onPaired }) {
  const { toast } = useUi();
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

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
      setCode("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 0);
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
        setCode("");
        inputRef.current?.focus();
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

  function onChange(e) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError("");
    if (digits.length === 6) connect(digits);
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
            {/* One real input drawn as six boxes, so typing fast, pasting and phone autofill all work */}
            <div className="code-inputs">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={"box" + (focused && i === Math.min(code.length, 5) ? " cur" : "")}>
                  {code[i] || ""}
                </div>
              ))}
              <input
                ref={inputRef}
                value={code}
                onChange={onChange}
                onKeyDown={(e) => e.key === "Enter" && connect(code)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                aria-label="Code from the kiln's screen"
              />
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
