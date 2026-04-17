import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthApi, AuthApiExt } from "../lib/api";

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

  useEffect(() => {
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

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: !!user,
      async login(email, password) {
        const data = await AuthApi.login(email, password);
        localStorage.setItem("zoree_token", data.token);
        localStorage.setItem("zoree_refresh_token", data.refresh_token || "");
        localStorage.setItem("zoree_user", JSON.stringify(data.user || null));
        setUser(data.user || null);
        return data;
      },
      logout() {
        localStorage.removeItem("zoree_token");
        localStorage.removeItem("zoree_user");
        setUser(null);
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
    [user, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
