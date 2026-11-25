import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Nếu App lỗi lúc khởi động thì hiện lỗi ra màn hình thay vì cửa sổ trắng.
try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (e) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<pre style="color:#fff;padding:24px;font-size:14px;white-space:pre-wrap">App lỗi khởi động: ${String(e)}</pre>`;
  }
  throw e;
}
