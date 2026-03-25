import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthApi } from "../lib/api";

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
        localStorage.setItem("zoree_user", JSON.stringify(data.user || null));
        setUser(data.user || null);
        return data;
      },
      logout() {
        localStorage.removeItem("zoree_token");
        localStorage.removeItem("zoree_user");
        setUser(null);
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
