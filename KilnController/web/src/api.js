// Talking to the kiln. The pairing token is sent with every request as X-Kiln-Token.

const TOKEN_KEY = "kilnToken";

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

let token = load(TOKEN_KEY, "");
let onUnauthorized = () => {};

export const getToken = () => token;

export function setToken(value) {
  token = value;
  store(TOKEN_KEY, value);
}

// Called when the kiln says this browser isn't paired (e.g. after FORGETWEB)
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(path, method = "GET", body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const headers = {};
    if (token) headers["X-Kiln-Token"] = token;
    const res = await fetch(path, { method, headers, body, signal: ctrl.signal, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      if (res.status === 401 && token) {
        setToken("");
        onUnauthorized();
      }
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const errorText = (e) => (e.name === "AbortError" ? "Can't reach the kiln" : e.message);
