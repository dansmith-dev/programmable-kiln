// A pretend kiln for working on the web page without the real one.
// Run:  npm run mock   (in the web folder)
//   - http://localhost:8080 serves the last build (npm run build)
//   - or run `npm run dev` alongside it for live reloading at http://localhost:5173
// The pairing code is printed here (the real kiln shows it on its screen).
// Time runs 60x faster than real life so you can watch a firing.
// SPEED=1 runs in real time.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 8080;
const SPEED = Number(process.env.SPEED) || 60;
const MAX_TEMP = 1300;

let steps = [[0, 600, 360], [0, 1000, 240], [1, 1000, 15]];
let programVersion = 1;
let state = "Idle", fault = "";
let temp = 21, heater = false;
let firingStart = 0, stepIndex = 0, stepStart = 0, stepStartTemp = 0, setpoint = 0;
let tokens = new Set();
let pairCode = "", pairExpires = 0, pairLeft = 0;
let history = [], lastSample = 0;

const simNow = (() => { const start = Date.now(); return () => start + (Date.now() - start) * SPEED; })();

function tick() {
  const now = simNow();
  if (state === "Running") {
    if (stepIndex >= steps.length) { state = "Finished"; heater = false; }
    else {
      const [type, target, mins] = steps[stepIndex];
      const elapsed = now - stepStart, dur = mins * 60000;
      setpoint = type === 1 || elapsed >= dur ? target : stepStartTemp + (target - stepStartTemp) * (elapsed / dur);
      heater = setpoint > temp;
      if (elapsed >= dur) { stepIndex++; stepStart = now; stepStartTemp = temp; }
    }
  } else heater = false;
  // crude thermal model, one simulated second per call
  const dt = SPEED;
  temp += (heater ? 0.09 : 0) * dt - (temp - 20) * 0.00012 * dt;
  if (now - lastSample >= 60000) {
    lastSample = now;
    history.push([Math.round(temp), state === "Running" ? Math.round(setpoint) : -1]);
    if (history.length > 1440) history.shift();
  }
}
setInterval(tick, 1000);

function status() {
  const now = simNow();
  let stepRemaining = 0, totalRemaining = 0;
  if (state === "Running" && stepIndex < steps.length) {
    stepRemaining = Math.max(0, steps[stepIndex][2] * 60 - (now - stepStart) / 1000);
    totalRemaining = stepRemaining + steps.slice(stepIndex + 1).reduce((a, s) => a + s[2] * 60, 0);
  }
  return {
    state, temp: +temp.toFixed(1), heater, fault, step: stepIndex, stepCount: steps.length,
    setpoint: +setpoint.toFixed(1), stepRemaining: Math.round(stepRemaining), totalRemaining: Math.round(totalRemaining),
    elapsed: state === "Running" ? Math.round((now - firingStart) / 1000) : 0,
    maxTemp: MAX_TEMP, maxSteps: 20, programVersion, rssi: -58,
  };
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      const built = path.join(__dirname, "dist", "index.html");
      if (!fs.existsSync(built)) return res.end("<p>Run <code>npm run build</code> first, or use <code>npm run dev</code>.</p>");
      return res.end(fs.readFileSync(built));
    }
    if (req.method === "POST" && url === "/api/pair/start") {
      if (!pairCode || Date.now() > pairExpires) {
        pairCode = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
        pairExpires = Date.now() + 180000;
        pairLeft = 5;
        console.log("Pairing code:", pairCode);
      }
      return send(res, 200, { seconds: Math.round((pairExpires - Date.now()) / 1000) });
    }
    if (req.method === "POST" && url === "/api/pair") {
      if (!pairCode || Date.now() > pairExpires) return send(res, 410, { error: "No code is showing on the kiln. Ask for a new one." });
      if (body.trim() !== pairCode) {
        if (--pairLeft <= 0) { pairCode = ""; return send(res, 403, { error: "Too many wrong codes. Ask for a new one." }); }
        return send(res, 403, { error: "That code doesn't match", left: pairLeft });
      }
      const token = crypto.randomBytes(16).toString("hex");
      tokens.add(token);
      pairCode = "";
      return send(res, 200, { token });
    }
    if (!url.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    const token = req.headers["x-kiln-token"];
    if (!tokens.has(token)) return send(res, 401, { error: "Not paired" });

    if (req.method === "GET" && url === "/api/status") return send(res, 200, status());
    if (req.method === "GET" && url === "/api/program") return send(res, 200, { version: programVersion, steps });
    if (req.method === "POST" && url === "/api/program") {
      if (state === "Running") return send(res, 409, { error: "Stop the firing before changing the program" });
      const parsed = body.split(";").filter((s) => s.trim()).map((s) => s.split(",").map(Number));
      if (parsed.length > 20 || parsed.some(([t, c, m]) => ![0, 1].includes(t) || !(c >= 0 && c <= MAX_TEMP) || !(m >= 1 && m <= 65535)))
        return send(res, 400, { error: "The program has an invalid step" });
      steps = parsed;
      programVersion++;
      if (state === "Finished") state = "Idle";
      return send(res, 200, { version: programVersion, steps });
    }
    if (req.method === "GET" && url === "/api/history") {
      return send(res, 200, {
        interval: 60, age: Math.round((simNow() - lastSample) / 1000 / SPEED),
        temp: history.map((h) => h[0]), set: history.map((h) => h[1]),
      });
    }
    if (req.method === "POST" && url === "/api/start") {
      if (state === "Fault") return send(res, 409, { error: "Clear the fault with Stop first" });
      if (!steps.length) return send(res, 409, { error: "There's no program to run" });
      if (state !== "Running") {
        state = "Running"; firingStart = stepStart = simNow(); stepIndex = 0; stepStartTemp = temp; history = []; lastSample = 0;
      }
      return send(res, 200, status());
    }
    if (req.method === "POST" && url === "/api/stop") { state = "Idle"; fault = ""; heater = false; return send(res, 200, status()); }
    if (req.method === "POST" && url === "/api/fault") { state = "Fault"; fault = "No temperature rise"; return send(res, 200, status()); }
    if (req.method === "POST" && url === "/api/unpair") { tokens.delete(token); return send(res, 200, {}); }
    send(res, 404, { error: "Not found" });
  });
}).listen(PORT, () => console.log(`Pretend kiln on http://localhost:${PORT} (time x${SPEED})`));
