import { useState } from "react";
import { useAuth } from "../state/AuthContext";

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
          <svg width="56" height="56" viewBox="0 0 62 62" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="zlogin" x1="0" y1="0" x2="62" y2="62" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#38BDF8"/><stop offset="100%" stopColor="#818CF8"/></linearGradient></defs>
            <circle cx="31" cy="31" r="29" fill="#111827" stroke="url(#zlogin)" strokeWidth="2"/>
            <line x1="15" y1="18" x2="47" y2="18" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <line x1="47" y1="18" x2="15" y2="44" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <line x1="15" y1="44" x2="47" y2="44" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <circle cx="47" cy="18" r="5" fill="#38BDF8"/>
          </svg>
          <div className="login-brand">zoree</div>
          <div className="login-subtitle">TMS PLATFORM</div>
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

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn" disabled={busy}>
            {busy ? "Signing in…" : "Sign In →"}
          </button>
        </form>

        <div className="login-footer">Secured by Supabase · Zoree LLC</div>
      </div>
    </div>
  );
}
