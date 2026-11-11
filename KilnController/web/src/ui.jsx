import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Toasts and confirm dialogs, available anywhere through useUi()
const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [toastState, setToastState] = useState(null);
  const [dialog, setDialog] = useState(null);
  const toastTimer = useRef(0);
  const okRef = useRef(null);

  const toast = useCallback((message, isError = false) => {
    setToastState({ message, isError, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), 3800);
  }, []);

  // confirm({title, body, okText, danger}) resolves to true or false
  const confirm = useCallback(
    (options) => new Promise((resolve) => setDialog({ ...options, resolve })),
    []
  );

  const close = (answer) => {
    dialog.resolve(answer);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return undefined;
    okRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      {dialog && (
        <div className="modal-back" onClick={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
            <h3 id="modalTitle">{dialog.title}</h3>
            <p>{dialog.body}</p>
            <div className="actions">
              <button className="btn ghost" onClick={() => close(false)}>Cancel</button>
              <button ref={okRef} className={"btn " + (dialog.danger ? "danger" : "primary")} onClick={() => close(true)}>
                {dialog.okText}
              </button>
            </div>
          </div>
        </div>
      )}
      {toastState && (
        <div key={toastState.key} className={"toast" + (toastState.isError ? " err" : "")} role="status">
          {toastState.message}
        </div>
      )}
    </UiContext.Provider>
  );
}

export const useUi = () => useContext(UiContext);
