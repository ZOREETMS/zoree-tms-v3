import { useState } from "react";
import { useAuth } from "../state/AuthContext";
import { BRAND } from "../config/brand";
import BrandMark from "../components/brand/BrandMark";

export default function LoginPage() {
  const { login } = useAuth();
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
