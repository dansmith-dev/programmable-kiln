import { useEffect, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api.js";
import { tempColor } from "./kiln.js";
import { useKiln } from "./useKiln.js";
import { useUi } from "./ui.jsx";
import FiringTab from "./components/FiringTab.jsx";
import Header from "./components/Header.jsx";
import Pairing from "./components/Pairing.jsx";

export default function App() {
  const { confirm } = useUi();
  const [paired, setPaired] = useState(() => !!getToken());
  const kiln = useKiln(paired);
  const { status } = kiln;

  useEffect(() => setUnauthorizedHandler(() => setPaired(false)), []);

  // Background glow follows the kiln temperature
  useEffect(() => {
    const root = document.documentElement.style;
    const t = status ? status.temp : 20;
    root.setProperty("--glow", tempColor(t));
    root.setProperty("--glow-strength", (0.08 + Math.min(1, Math.max(0, (t - 250) / 700)) * 0.5).toFixed(2));
  }, [status?.temp]);

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
            <FiringTab kiln={kiln} />
          </section>
        )}
      </main>
    </>
  );
}
