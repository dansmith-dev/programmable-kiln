import { useEffect, useId, useRef, useState } from "react";
import { tempColor } from "../kiln.js";

const HEIGHT = 260;
const M = { l: 44, r: 12, t: 12, b: 26 };
const X_STEPS = [300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200];

function niceStep(range, target) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// series: [{ pts: [[x, temp]...], kind: "actual" | "set" | "plan" }], x in seconds
export default function Chart({ series, xMin, xMax, xLabel, nowX, emptyText }) {
  const [ref, W] = useWidth();
  const id = useId().replace(/:/g, "");
  const H = HEIGHT;
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const all = series.flatMap((s) => s.pts);

  if (!all.length || !(xMax > xMin)) {
    return (
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`}>
        <text className="empty" x={W / 2} y={H / 2} textAnchor="middle">{emptyText || "No data yet"}</text>
      </svg>
    );
  }

  let yMax = Math.max(100, ...all.map((p) => p[1]));
  const yStep = niceStep(yMax, 5);
  yMax = Math.ceil(yMax / yStep) * yStep;
  const X = (x) => M.l + ((x - xMin) / (xMax - xMin)) * pw;
  const Y = (y) => M.t + ph - (Math.max(0, y) / yMax) * ph;
  const path = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");

  const yTicks = [];
  for (let y = 0; y <= yMax; y += yStep) yTicks.push(y);
  const xStep = X_STEPS.find((s) => (xMax - xMin) / s <= 7) || 86400;
  const xTicks = [];
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) xTicks.push(x);

  return (
    <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1={Y(0)} x2="0" y2={Y(yMax)}>
          {Array.from({ length: 11 }, (_, k) => (
            <stop key={k} offset={k / 10} stopColor={tempColor((yMax * k) / 10)} />
          ))}
        </linearGradient>
        <linearGradient id={id + "Fill"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a2f" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ff7a2f" stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((y) => (
        <g key={"y" + y}>
          <line className="grid-line" x1={M.l} x2={W - M.r} y1={Y(y)} y2={Y(y)} />
          <text x={M.l - 8} y={Y(y) + 4} textAnchor="end">{y}°</text>
        </g>
      ))}
      {xTicks.map((x) => (
        <text key={"x" + x} x={X(x)} y={H - 6} textAnchor="middle">{xLabel(x)}</text>
      ))}
      {nowX != null && nowX > xMin && nowX < xMax && (
        <line className="now-line" x1={X(nowX)} x2={X(nowX)} y1={M.t} y2={M.t + ph} />
      )}

      {series.map((s) => {
        if (!s.pts.length) return null;
        if (s.kind !== "actual") return <path key={s.kind} className={s.kind} d={path(s.pts)} />;
        const first = s.pts[0];
        const last = s.pts[s.pts.length - 1];
        const lx = X(last[0]);
        const ly = Y(last[1]);
        const c = tempColor(last[1]);
        return (
          <g key={s.kind}>
            <path d={`${path(s.pts)}L${lx.toFixed(1)} ${Y(0)}L${X(first[0]).toFixed(1)} ${Y(0)}Z`} fill={`url(#${id}Fill)`} />
            <path className="actual" d={path(s.pts)} stroke={`url(#${id})`} />
            <circle cx={lx} cy={ly} r="7" fill={c} opacity="0.25" />
            <circle cx={lx} cy={ly} r="3.5" fill={c} />
          </g>
        );
      })}
    </svg>
  );
}
