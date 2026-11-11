import { useEffect, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api.js";
import { useUi } from "./ui.jsx";
import Header from "./components/Header.jsx";
import Pairing from "./components/Pairing.jsx";

export default function App() {
  const { confirm } = useUi();
  const [paired, setPaired] = useState(() => !!getToken());

  useEffect(() => setUnauthorizedHandler(() => setPaired(false)), []);

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
      <Header paired={paired} connected={null} onDisconnect={disconnect} />
      <main>
        {!paired ? (
          <Pairing onPaired={() => setPaired(true)} />
        ) : (
          <div className="card empty-state">Connected to your kiln. The dashboard is next.</div>
        )}
      </main>
    </>
  );
}
