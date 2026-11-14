// Formatting, colours and program maths shared by the components.

export const ROOM_TEMP = 20;

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return m + "m";
  return h + "h " + String(m).padStart(2, "0") + "m";
}

export const fmtMins = (mins) => fmtDuration(mins * 60);

export const fmtClock = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Approximate colour of glowing ceramic at a temperature
const COLOUR_STOPS = [
  [0, [96, 112, 140]], [300, [120, 100, 110]], [500, [110, 30, 24]], [650, [178, 32, 22]],
  [800, [232, 70, 20]], [950, [255, 128, 32]], [1100, [255, 190, 70]], [1250, [255, 232, 160]], [1400, [255, 248, 230]],
];

export function tempColor(t) {
  let rgb = COLOUR_STOPS[COLOUR_STOPS.length - 1][1];
  if (t <= COLOUR_STOPS[0][0]) rgb = COLOUR_STOPS[0][1];
  else {
    for (let i = 1; i < COLOUR_STOPS.length; i++) {
      const [t1, c1] = COLOUR_STOPS[i];
      if (t <= t1) {
        const [t0, c0] = COLOUR_STOPS[i - 1];
        const f = (t - t0) / (t1 - t0);
        rgb = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
        break;
      }
    }
  }
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// ---------- Program ----------

let nextId = 1;

// Steps in the editor carry an id so React can keep each row's input text while rows move
export const withIds = (steps) => steps.map((s) => ({ type: s.type, temp: s.temp, mins: s.mins, id: nextId++ }));

export const parseProgram = (p) => ({ version: p.version, steps: p.steps.map(([type, temp, mins]) => ({ type, temp, mins })) });

export const programBody = (steps) => steps.map((s) => `${s.type},${s.temp},${s.mins}`).join(";");

export const sameSteps = (a, b) =>
  a.length === b.length && a.every((s, i) => s.type === b[i].type && s.temp === b[i].temp && s.mins === b[i].mins);

export const totalMins = (steps) => steps.reduce((a, s) => a + (Number(s.mins) || 0), 0);

export const peakTemp = (steps) => steps.reduce((a, s) => Math.max(a, Number(s.temp) || 0), 0);

export const validTemp = (t, maxTemp) => Number.isInteger(t) && t >= 0 && t <= maxTemp;
export const validMins = (m) => Number.isInteger(m) && m >= 1 && m <= 65535;
export const validStep = (s, maxTemp) => validTemp(s.temp, maxTemp) && validMins(s.mins);

export function stepDescription(step, prevTemp) {
  if (step.type === 1) return `Hold at ${step.temp}°C for ${fmtMins(step.mins)}`;
  let text = `Ramp to ${step.temp}°C over ${fmtMins(step.mins)}`;
  if (prevTemp != null && step.mins > 0) {
    const rate = Math.round(((step.temp - prevTemp) / step.mins) * 60);
    text += ` (${rate > 0 ? "+" : ""}${rate}°C/h)`;
  }
  return text;
}

// [seconds from start, temp] points the program aims to follow
export function planPoints(steps, startTemp) {
  const pts = [[0, startTemp]];
  let t = 0;
  for (const st of steps) {
    if (st.type === 1) pts.push([t, st.temp]);
    t += st.mins * 60;
    pts.push([t, st.temp]);
  }
  return pts;
}

// Kiln history samples followed by the live readings since: [[unix seconds, temp, setpoint or -1]]
export function readings(history, liveTail) {
  const out = [];
  if (history && history.temp.length) {
    const n = history.temp.length;
    const newest = history.receivedAt / 1000 - history.age;
    for (let k = 0; k < n; k++) {
      out.push([newest - (n - 1 - k) * history.interval, history.temp[k], history.set[k]]);
    }
  }
  return out.concat(liveTail);
}

// Heating rate in °C/h over the last ~10 minutes, or null with less than a minute of readings
export function heatingRate(r) {
  if (r.length < 2) return null;
  const last = r[r.length - 1];
  let first = r[0];
  for (let k = r.length - 2; k >= 0; k--) {
    first = r[k];
    if (last[0] - r[k][0] >= 600) break;
  }
  const span = last[0] - first[0];
  if (span < 60) return null;
  return ((last[1] - first[1]) / span) * 3600;
}
