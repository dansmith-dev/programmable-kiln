import { useState } from "react";
import { load, store } from "../api.js";
import {
  ROOM_TEMP, fmtDuration, fmtMins, peakTemp, planPoints, totalMins, validMins, validStep, validTemp, withIds,
} from "../kiln.js";
import { useUi } from "../ui.jsx";
import Chart from "./Chart.jsx";
import { Down, Trash, Up } from "./Icons.jsx";

const PRESET_KEY = "kilnPresets";

export default function ProgramTab({ draft, setDraft, dirty, maxTemp, maxSteps, notice, onSave, onRevert, saving }) {
  const { toast } = useUi();
  const allValid = draft.every((s) => validStep(s, maxTemp));

  const update = (id, changes) => setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  const remove = (id) => setDraft((d) => d.filter((s) => s.id !== id));
  const move = (index, dir) =>
    setDraft((d) => {
      const next = [...d];
      [next[index], next[index + dir]] = [next[index + dir], next[index]];
      return next;
    });
  const add = () =>
    setDraft((d) => {
      const last = d[d.length - 1];
      return [...d, ...withIds([last ? { type: 1, temp: last.temp, mins: 15 } : { type: 0, temp: 600, mins: 360 }])];
    });

  const validSteps = draft.filter((s) => validStep(s, maxTemp));
  const plan = planPoints(validSteps, ROOM_TEMP);

  let message = notice;
  if (!allValid) message = "Fix the highlighted values before saving.";
  else if (dirty) message = "Unsaved changes";

  return (
    <div className="grid program-grid">
      <div className="grid">
        <div className="card">
          <h2>Profile</h2>
          <Chart
            series={validSteps.length ? [{ kind: "actual", pts: plan }] : []}
            xMin={0}
            xMax={Math.max(plan[plan.length - 1][0], 3600)}
            xLabel={(x) => (x % 3600 === 0 ? x / 3600 + "h" : fmtDuration(x))}
            emptyText="Add a step to see the firing profile"
          />
        </div>
        <div>
          <div className="step-list">
            {draft.length === 0 && (
              <div className="card empty-state">
                No steps yet. A typical program starts with a slow ramp, then a faster one up to the peak and a short hold.
              </div>
            )}
            {draft.map((step, i) => (
              <StepRow
                key={step.id}
                step={step}
                index={i}
                count={draft.length}
                prevTemp={i === 0 ? ROOM_TEMP : draft[i - 1].temp}
                maxTemp={maxTemp}
                onChange={(changes) => update(step.id, changes)}
                onRemove={() => remove(step.id)}
                onMove={(dir) => move(i, dir)}
              />
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="add-step" onClick={add} disabled={draft.length >= maxSteps}>+ Add step</button>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Summary</h2>
          <div className="summary">
            <div className="stat"><div className="label">Total time</div><div className="value num">{draft.length ? fmtMins(totalMins(draft)) : "—"}</div></div>
            <div className="stat"><div className="label">Peak</div><div className="value num">{draft.length ? peakTemp(draft) + "°C" : "—"}</div></div>
          </div>
          <div className="program-actions">
            <div className="notice">{message}</div>
            <button className="btn primary" onClick={onSave} disabled={!dirty || !allValid || saving}>Save to kiln</button>
            <button className="btn ghost" onClick={onRevert} disabled={!dirty}>Undo changes</button>
          </div>
        </div>
        <Presets draft={draft} setDraft={setDraft} allValid={allValid} toast={toast} />
      </div>
    </div>
  );
}

// Inputs keep their own text so half-typed values (empty, "1") don't get overwritten
function StepRow({ step, index, count, prevTemp, maxTemp, onChange, onRemove, onMove }) {
  const [text, setText] = useState({
    temp: String(step.temp),
    h: String(Math.floor(step.mins / 60)),
    m: String(step.mins % 60),
  });

  function edit(field, value) {
    const next = { ...text, [field]: value };
    setText(next);
    const num = (v) => (v.trim() === "" ? NaN : Number(v));
    onChange({
      temp: num(next.temp),
      mins: Math.round((num(next.h) || 0) * 60 + (num(next.m) || 0)),
    });
  }

  const tempBad = !validTemp(step.temp, maxTemp);
  const minsBad = !validMins(step.mins);
  let rateText;
  if (tempBad || minsBad) rateText = `Temperature 0–${maxTemp}°C, time at least 1 minute`;
  else if (step.type === 1) rateText = `Holds for ${fmtMins(step.mins)}`;
  else {
    const rate = Math.round(((step.temp - prevTemp) / step.mins) * 60);
    rateText = `${rate >= 0 ? "Heats" : "Cools"} at about ${Math.abs(rate)}°C/h${index === 0 ? " from room temperature" : ""}`;
  }

  return (
    <div className="step-row">
      <div className="n">{index + 1}</div>
      <div className="step-fields">
        <div className="seg-toggle">
          <button className={step.type === 0 ? "on" : ""} onClick={() => onChange({ type: 0 })}>Ramp</button>
          <button className={step.type === 1 ? "on" : ""} onClick={() => onChange({ type: 1 })}>Hold</button>
        </div>
        <label className="field">
          {step.type === 1 ? "at" : "to"}{" "}
          <input className={tempBad ? "bad" : ""} inputMode="numeric" value={text.temp}
            onChange={(e) => edit("temp", e.target.value)} /> °C
        </label>
        <label className="field">
          for <input className={"short" + (minsBad ? " bad" : "")} inputMode="numeric" value={text.h}
            onChange={(e) => edit("h", e.target.value)} /> h{" "}
          <input className={"short" + (minsBad ? " bad" : "")} inputMode="numeric" value={text.m}
            onChange={(e) => edit("m", e.target.value)} /> m
        </label>
        <div className="rate">{rateText}</div>
      </div>
      <div className="row-tools">
        <button className="icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><Up /></button>
        <button className="icon-btn" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><Down /></button>
        <button className="icon-btn" aria-label="Delete step" onClick={onRemove}><Trash /></button>
      </div>
    </div>
  );
}

// Named programs kept in this browser's storage
function Presets({ draft, setDraft, allValid, toast }) {
  const { confirm } = useUi();
  const [presets, setPresets] = useState(() => load(PRESET_KEY, {}));
  const names = Object.keys(presets).sort();
  const [selected, setSelected] = useState(names[0] || "");
  const [name, setName] = useState("");
  const current = names.includes(selected) ? selected : names[0] || "";

  const save = (next) => {
    setPresets(next);
    store(PRESET_KEY, next);
  };

  function savePreset() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!draft.length || !allValid) {
      toast("Fix the program before saving it", true);
      return;
    }
    save({ ...presets, [trimmed]: draft.map(({ type, temp, mins }) => ({ type, temp, mins })) });
    setSelected(trimmed);
    setName("");
    toast(`Saved "${trimmed}" in this browser`);
  }

  async function deletePreset() {
    if (!current) return;
    if (!(await confirm({ title: "Delete saved program?", body: `"${current}" will be removed from this browser.`, okText: "Delete", danger: true }))) return;
    const next = { ...presets };
    delete next[current];
    save(next);
  }

  return (
    <div className="card presets">
      <h2>Saved programs</h2>
      <p className="hint">Kept in this browser, so you can switch between bisque, glaze and so on.</p>
      <div className="line">
        <select value={current} onChange={(e) => setSelected(e.target.value)} disabled={!names.length}>
          {names.length ? names.map((n) => <option key={n}>{n}</option>) : <option value="">None saved yet</option>}
        </select>
        <button
          className="btn small"
          disabled={!current}
          onClick={() => {
            setDraft(withIds(presets[current]));
            toast("Loaded. Press Save to kiln to use it.");
          }}
        >
          Load
        </button>
        <button className="icon-btn" aria-label="Delete saved program" disabled={!current} onClick={deletePreset}><Trash /></button>
      </div>
      <form className="line" onSubmit={(e) => { e.preventDefault(); savePreset(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Bisque 1000°C" maxLength={40} />
        <button className="btn small" type="submit">Save</button>
      </form>
    </div>
  );
}
