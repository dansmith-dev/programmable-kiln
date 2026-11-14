import { api, errorText } from "../api.js";
import { fmtClock, fmtDuration, fmtMins, heatingRate, peakTemp, planPoints, readings, stepDescription, totalMins } from "../kiln.js";
import { useUi } from "../ui.jsx";
import Chart from "./Chart.jsx";
import Gauge from "./Gauge.jsx";
import { Alert, Heat } from "./Icons.jsx";

export default function FiringTab({ kiln }) {
  const { status: s, program, history, liveTail } = kiln;
  const { toast, confirm } = useUi();
  if (!s) return <div className="card empty-state">Waiting for the kiln…</div>;

  const steps = program.steps;
  const running = s.state === "Running";
  const fault = s.state === "Fault";
  const r = readings(history, liveTail);
  const rate = heatingRate(r);

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

  // Current step headline
  let title, desc;
  if (running && s.step < steps.length) {
    const st = steps[s.step];
    title = `Step ${s.step + 1} of ${steps.length} · ${st.type === 1 ? "Hold" : "Ramp"}`;
    desc = stepDescription(st, s.step === 0 ? null : steps[s.step - 1].temp);
  } else if (s.state === "Finished") {
    title = "Firing finished";
    desc = "Leave the kiln to cool before opening it.";
  } else if (fault) {
    title = "Stopped by a fault";
    desc = "";
  } else {
    title = steps.length ? "Ready to fire" : "No program";
    desc = steps.length
      ? `${steps.length} step${steps.length === 1 ? "" : "s"} · ${fmtMins(totalMins(steps))} · peak ${peakTemp(steps)}°C`
      : "Set up a program on the Program tab.";
  }

  // Chart: kiln history + live readings, and the plan while firing
  const nowSec = Date.now() / 1000;
  const series = [];
  let xMin = Infinity;
  let xMax = -Infinity;
  if (running && steps.length) {
    const startAt = nowSec - s.elapsed;
    const plan = planPoints(steps, r.length ? r[0][1] : s.temp).map(([x, y]) => [startAt + x, y]);
    series.push({ kind: "plan", pts: plan });
    xMin = startAt;
    xMax = plan[plan.length - 1][0];
  }
  if (r.length) {
    series.push({ kind: "set", pts: r.filter((p) => p[2] >= 0).map((p) => [p[0], p[2]]) });
    series.push({ kind: "actual", pts: r.map((p) => [p[0], p[1]]) });
    xMin = Math.min(xMin, r[0][0]);
    xMax = Math.max(xMax, nowSec);
  }
  if (xMax - xMin < 1800) xMax = xMin + 1800;

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

        <div className="card">
          <div className="step-now">
            <div>
              <div className="title">{title}</div>
              <div className="desc">{desc}</div>
            </div>
          </div>
          <Timeline steps={steps} status={s} />
        </div>

        <div className="stats">
          <Stat label="Step time left" value={running ? fmtDuration(s.stepRemaining) : "—"} />
          <Stat
            label="Total time left"
            value={running ? fmtDuration(s.totalRemaining) : steps.length && !fault ? fmtMins(totalMins(steps)) : "—"}
            sub={running ? "Done around " + fmtClock(new Date(Date.now() + s.totalRemaining * 1000)) : ""}
          />
          <Stat label="Elapsed" value={running ? fmtDuration(s.elapsed) : "—"} />
          <Stat label="Rate now" value={rate == null ? "—" : (rate > 0.5 ? "+" : "") + Math.round(rate)} sub="°C per hour" />
        </div>

        <div className="card">
          <h2>Temperature</h2>
          <Chart
            series={series}
            xMin={xMin}
            xMax={xMax}
            nowX={nowSec}
            xLabel={(x) => fmtClock(new Date(x * 1000))}
            emptyText="Collecting temperature readings…"
          />
          <div className="legend">
            <span><i style={{ borderColor: "#ff8a3d" }} />Actual</span>
            <span><i style={{ borderColor: "rgba(255,179,71,.7)" }} />Target</span>
            <span><i style={{ borderColor: "rgba(255,236,224,.45)", borderTopStyle: "dashed" }} />Plan</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function Timeline({ steps, status: s }) {
  if (!steps.length) return null;
  const running = s.state === "Running";
  return (
    <>
      <div className="timeline">
        {steps.map((st, i) => {
          let width = 0;
          if (s.state === "Finished" || (running && i < s.step)) width = 100;
          else if (running && i === s.step) width = 100 * (1 - s.stepRemaining / (st.mins * 60));
          return (
            <div
              key={i}
              className={"seg" + (st.type === 1 ? " hold" : "")}
              style={{ flexGrow: st.mins }}
              title={`Step ${i + 1}: ${st.type === 1 ? "Hold" : "Ramp"} ${st.temp}°C, ${fmtMins(st.mins)}`}
            >
              <i style={{ width: width.toFixed(1) + "%" }} />
            </div>
          );
        })}
      </div>
      <div className="timeline-labels">
        {running ? (
          <>
            <span>Started {fmtClock(new Date(Date.now() - s.elapsed * 1000))}</span>
            <span>Ends {fmtClock(new Date(Date.now() + s.totalRemaining * 1000))}</span>
          </>
        ) : (
          <>
            <span>Start</span>
            <span>{fmtMins(totalMins(steps))}</span>
          </>
        )}
      </div>
    </>
  );
}
