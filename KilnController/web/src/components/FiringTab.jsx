import { api, errorText } from "../api.js";
import { fmtMins, peakTemp, totalMins } from "../kiln.js";
import { useUi } from "../ui.jsx";
import Gauge from "./Gauge.jsx";
import { Alert, Heat } from "./Icons.jsx";

export default function FiringTab({ kiln }) {
  const { status: s, program } = kiln;
  const { toast, confirm } = useUi();
  if (!s) return <div className="card empty-state">Waiting for the kiln…</div>;

  const steps = program.steps;
  const running = s.state === "Running";
  const fault = s.state === "Fault";

  async function start() {
    let body = `${steps.length} steps, about ${fmtMins(totalMins(steps))}, up to ${peakTemp(steps)}°C. Make sure the kiln is loaded, closed and nothing is near it.`;
    if (!(await confirm({ title: "Start firing?", body, okText: "Start firing" }))) return;
    try {
      kiln.applyStatus(await api("/api/start", "POST", ""));
      toast("Firing started");
    } catch (e) {
      toast(errorText(e), true);
    }
  }

  async function stop() {
    if (!fault && !(await confirm({
      title: "Stop the firing?",
      body: "The heater turns off straight away and the program can't be resumed.",
      okText: "Stop firing",
      danger: true,
    }))) return;
    try {
      kiln.applyStatus(await api("/api/stop", "POST", ""));
      toast(fault ? "Fault cleared" : "Firing stopped");
    } catch (e) {
      toast(errorText(e), true);
    }
  }

  return (
    <div className="grid firing-grid">
      <div className="card hero">
        <Gauge temp={s.temp} setpoint={running ? s.setpoint : null} max={s.maxTemp} />
        <div className="pills">
          <span className={"pill state-" + s.state}><span className="dot" />{s.state}</span>
          <span className={"pill heater" + (s.heater ? " on" : "")}><Heat />{s.heater ? "Heating" : "Heater off"}</span>
        </div>
        <div className="actions">
          {running || fault ? (
            <button className="btn danger" onClick={stop}>{fault ? "Clear fault" : "Stop firing"}</button>
          ) : (
            <button className="btn primary" onClick={start} disabled={s.stepCount === 0}>
              {s.stepCount === 0 ? "No program" : s.state === "Finished" ? "Fire again" : "Start firing"}
            </button>
          )}
        </div>
      </div>

      <div className="grid">
        {fault && (
          <div className="fault">
            <Alert />
            <div>
              <strong>{s.fault || "Fault"}</strong>
              The heater is off. Check the kiln, then press Clear fault (or Stop on the screen).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
