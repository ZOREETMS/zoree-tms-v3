import { useEffect, useState } from "react";
import { useAuth } from "../state/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  const apiBase =
    import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api";
  const apiOrigin = apiBase.replace(/\/api\/?$/, "");

  useEffect(() => {
    let active = true;
    fetch(`${apiOrigin}/health`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setHealth(data);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || "Failed to load health.");
      });
    return () => {
      active = false;
    };
  }, [apiOrigin]);

  return (
    <div>
      <h2>Settings</h2>
      <div className="card">
        <div>
          <strong>User:</strong> {user?.email || "-"}
        </div>
        <div>
          <strong>API Base:</strong>{" "}
          {apiBase}
        </div>
      </div>
      <div className="card">
        <div>
          <strong>API Health:</strong> {health ? "Connected" : error ? "Unavailable" : "Loading..."}
        </div>
        <div>
          <strong>SMTP Host:</strong> {health?.tenderEmail?.smtpHost || "-"}
        </div>
        <div>
          <strong>Email Verify:</strong>{" "}
          {health?.tenderEmail?.verifyOk === true
            ? "OK"
            : health?.tenderEmail?.verifyOk === false
              ? `Failed (${health?.tenderEmail?.verifyError || "Unknown"})`
              : "Not checked"}
        </div>
        {error ? <div className="error">{error}</div> : null}
      </div>
    </div>
  );
}
