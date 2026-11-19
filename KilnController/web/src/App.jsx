import { useEffect, useRef, useState } from "react";
import { api, errorText, getToken, setToken, setUnauthorizedHandler } from "./api.js";
import { parseProgram, programBody, sameSteps, tempColor, withIds } from "./kiln.js";
import { useKiln } from "./useKiln.js";
import { useUi } from "./ui.jsx";
import FiringTab from "./components/FiringTab.jsx";
import Header from "./components/Header.jsx";
import Pairing from "./components/Pairing.jsx";
import ProgramTab from "./components/ProgramTab.jsx";

export default function App() {
  const { toast, confirm } = useUi();
  const [paired, setPaired] = useState(() => !!getToken());
  const [tab, setTab] = useState("firing");
  const kiln = useKiln(paired);
  const { status, program } = kiln;

  // The program being edited. It follows the kiln's program until the user changes it.
  const [draft, setDraft] = useState([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const prevProgram = useRef(program);

  const dirty = !sameSteps(draft, program.steps);
  const running = status?.state === "Running";

  useEffect(() => setUnauthorizedHandler(() => setPaired(false)), []);

  useEffect(() => {
    const prev = prevProgram.current;
    prevProgram.current = program;
    if (sameSteps(draftRef.current, program.steps)) setNotice((n) => (n === "Saved" ? n : ""));
    else if (sameSteps(draftRef.current, prev.steps)) setDraft(withIds(program.steps));
    else setNotice("The program was changed on the kiln. Undo changes to see it.");
  }, [program]);

  // Background glow follows the kiln temperature
  useEffect(() => {
    const root = document.documentElement.style;
    const t = status ? status.temp : 20;
    root.setProperty("--glow", tempColor(t));
    root.setProperty("--glow-strength", (0.08 + Math.min(1, Math.max(0, (t - 250) / 700)) * 0.5).toFixed(2));
  }, [status?.temp]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function saveProgram() {
    setSaving(true);
    try {
      const p = parseProgram(await api("/api/program", "POST", programBody(draft)));
      setDraft(withIds(p.steps));
      kiln.programSaved(p);
      setNotice("Saved");
      toast("Program saved to the kiln");
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!(await confirm({
      title: "Disconnect this device?",
      body: "You'll need a new code from the kiln's screen to connect again.",
      okText: "Disconnect",
      danger: true,
    }))) return;
    try {
      await api("/api/unpair", "POST", "");
    } catch {}
    setToken("");
    setPaired(false);
  }

  return (
    <>
      <Header paired={paired} connected={kiln.connected} onDisconnect={disconnect} />
      <main>
        {!paired ? (
          <Pairing onPaired={() => setPaired(true)} />
        ) : (
          <section>
            <div className="tabs" role="tablist">
              {[["firing", "Firing"], ["program", "Program"]].map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>
            {tab === "firing" ? (
              <FiringTab kiln={kiln} dirty={dirty} />
            ) : (
              <ProgramTab
                draft={draft}
                setDraft={setDraft}
                dirty={dirty}
                running={running}
                maxTemp={status?.maxTemp ?? 1300}
                maxSteps={status?.maxSteps ?? 20}
                notice={notice}
                saving={saving}
                onSave={saveProgram}
                onRevert={() => {
                  setDraft(withIds(program.steps));
                  setNotice("");
                }}
              />
            )}
          </section>
        )}
      </main>
    </>
  );
}
