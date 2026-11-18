import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthApi, AuthApiExt, MicrosoftAuthApi, resetSessionExpiredLatch } from "../lib/api";
import { microsoftSignOutUrl, startMicrosoftSignIn, takeMicrosoftRedirect } from "../lib/microsoftSignIn";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("zoree_user");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  const [booting, setBooting] = useState(true);
  const [ssoError, setSsoError] = useState("");

  function storeSession(data) {
    localStorage.setItem("zoree_token", data.token);
    localStorage.setItem("zoree_refresh_token", data.refresh_token || "");
    localStorage.setItem("zoree_user", JSON.stringify(data.user || null));
    // New session — re-arm the one-shot session-expired latch so
    // the next 401 can bounce the user back to login again.
    resetSessionExpiredLatch();
    setUser(data.user || null);
  }

  useEffect(() => {
    // Coming back from Microsoft sign-in: turn that session into TMS roles.
    const ms = takeMicrosoftRedirect();
    if (ms) {
      if (ms.error) {
        setSsoError(ms.error);
        setBooting(false);
        return;
      }
      MicrosoftAuthApi.session(ms.accessToken, ms.refreshToken)
        .then(storeSession)
        .catch((e) => {
          localStorage.removeItem("zoree_token");
          localStorage.removeItem("zoree_user");
          setUser(null);
          setSsoError(e.message || "Microsoft sign-in failed");
        })
        .finally(() => setBooting(false));
      return;
    }
    const t = localStorage.getItem("zoree_token");
    if (!t) {
      setBooting(false);
      return;
    }
    AuthApi.me()
      .then((res) => {
        if (res?.user) setUser(res.user);
      })
      .catch(() => {
        localStorage.removeItem("zoree_token");
        localStorage.removeItem("zoree_user");
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  // When `api.js` detects an unrecoverable 401 (no refresh token, or
  // refresh token rejected) it dispatches `zoree:session-expired`.
  // Drop the in-memory user so App.jsx re-renders <LoginPage /> instead
  // of leaving the feature modal open with a "Missing Authorization
  // header" error visible. localStorage was already cleared by
  // fireSessionExpired() in api.js — this just syncs React state.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("zoree:session-expired", onExpired);
    return () => window.removeEventListener("zoree:session-expired", onExpired);
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: !!user,
      ssoError,
      async login(email, password) {
        const data = await AuthApi.login(email, password);
        storeSession(data);
        return data;
      },
      async loginWithMicrosoft() {
        setSsoError("");
        await startMicrosoftSignIn();
      },
      logout() {
        const viaMicrosoft = user && user.signIn === "microsoft";
        localStorage.removeItem("zoree_token");
        localStorage.removeItem("zoree_refresh_token");
        localStorage.removeItem("zoree_user");
        setUser(null);
        if (viaMicrosoft) {
          // Signed in with Microsoft: end that session too, or the next
          // "Sign in with Microsoft" would reuse it without asking.
          MicrosoftAuthApi.config()
            .then((c) => { window.location.assign(microsoftSignOutUrl(c && c.tenantId)); })
            .catch(() => { window.location.assign(microsoftSignOutUrl(null)); });
        }
      },
      // REQ-08: switch the currently-active role without re-login.
      async switchRole(nextRole) {
        if (!user) throw new Error("Not signed in");
        if (!Array.isArray(user.roles) || !user.roles.includes(nextRole)) {
          throw new Error(`Role '${nextRole}' not assigned to this user`);
        }
        const res = await AuthApiExt.setActiveRole(nextRole);
        const next = res?.user || { ...user, role: nextRole, activeRole: nextRole };
        localStorage.setItem("zoree_user", JSON.stringify(next));
        setUser(next);
        return next;
      },
    }),
    [user, booting, ssoError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
