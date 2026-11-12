import { tempColor } from "../kiln.js";

const R = 86;
const C = 2 * Math.PI * R;
const SWEEP = 0.75;   // 270° arc, open at the bottom
const ROTATE = "rotate(135 100 100)";

export default function Gauge({ temp, setpoint, max }) {
  const colour = tempColor(temp);
  const fraction = Math.min(1, Math.max(0, temp / max));
  let dot = null;
  if (setpoint != null) {
    const a = ((135 + 270 * Math.min(1, Math.max(0, setpoint / max))) * Math.PI) / 180;
    dot = { x: 100 + R * Math.cos(a), y: 100 + R * Math.sin(a) };
  }

  return (
    <div className="gauge" style={{ "--gauge-color": colour }}>
      <svg viewBox="0 0 200 200">
        <circle className="track" cx="100" cy="100" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${C * SWEEP} ${C}`} transform={ROTATE} />
        <circle className="value" cx="100" cy="100" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, C * SWEEP * fraction)} ${C}`} transform={ROTATE} stroke={colour} />
        {dot && <circle cx={dot.x} cy={dot.y} r="6" fill="#fff" stroke="#120d0b" strokeWidth="3" />}
      </svg>
      <div className="gauge-center">
        <div className="temp num">{Math.round(temp)}<sup>°C</sup></div>
        <div className="target num">{setpoint != null ? `Target ${Math.round(setpoint)}°C` : ""}</div>
      </div>
    </div>
  );
}
