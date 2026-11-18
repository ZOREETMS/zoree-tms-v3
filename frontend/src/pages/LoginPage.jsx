import { useEffect, useState } from "react";
import { useAuth } from "../state/AuthContext";
import { BRAND } from "../config/brand";
import BrandMark from "../components/brand/BrandMark";
import { MicrosoftAuthApi } from "../lib/api";

export default function LoginPage() {
  const { login, loginWithMicrosoft, ssoError } = useAuth();
  const [ms, setMs] = useState({ enabled: false, label: "" });
  const [msBusy, setMsBusy] = useState(false);

  useEffect(() => {
    MicrosoftAuthApi.config().then((c) => setMs(c || { enabled: false })).catch(() => {});
  }, []);

  async function onMicrosoft() {
    setMsBusy(true);
    setError("");
    try {
      await loginWithMicrosoft(); // leaves the page for Microsoft's sign-in
    } catch (err) {
      setError(err.message || "Microsoft sign-in failed");
      setMsBusy(false);
    }
  }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-overlay">
      <div className="login-card">
        {/* Logo — exact match from old app */}
        <div className="login-logo">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}><BrandMark size={56} /></div>
          <div className="login-brand">{BRAND.word}</div>
          <div className="login-subtitle">{BRAND.sub}</div>
          <div className="login-tagline">{BRAND.tagline}</div>
        </div>

        {ms.enabled && (
          <>
            <button
              type="button"
              id="login-microsoft"
              className="login-btn"
              onClick={onMicrosoft}
              disabled={msBusy}
              style={{ background: "#ffffff", color: "#1f2937", border: "1px solid #d1d5db", marginTop: 0, marginBottom: 6 }}
            >
              {msBusy ? "Opening Microsoft sign-in…" : (ms.label || "Sign in with Microsoft")}
            </button>
            <div style={{ fontSize: 11, color: "#6b7280", textAlign: "center", marginBottom: 14 }}>
              Your company's Microsoft account. Roles come from your IT groups.
            </div>
            {ssoError && <div className="login-error" style={{ marginBottom: 12 }}>{ssoError}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 14px", color: "#9ca3af", fontSize: 11 }}>
              <span style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
              or use a TMS password
              <span style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            </div>
          </>
        )}
        {!ms.enabled && ssoError && <div className="login-error" style={{ marginBottom: 12 }}>{ssoError}</div>}

        <form onSubmit={onSubmit}>
          <label className="login-label">EMAIL</label>
          <input
            id="login-email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="login-input"
            autoComplete="email"
            required
          />

          <label className="login-label">PASSWORD</label>
          <input
            id="login-pass"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input login-pass"
            autoComplete="current-password"
            required
          />

          <a className="login-forgot" href="#" onClick={(e) => { e.preventDefault(); alert("Password reset coming soon"); }}>
            Forgot password?
          </a>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn" disabled={busy}>
            {busy ? "Signing in…" : "Sign In →"}
          </button>
        </form>

        <div className="login-footer">Secured by Supabase · {BRAND.company}</div>
      </div>
    </div>
  );
}
