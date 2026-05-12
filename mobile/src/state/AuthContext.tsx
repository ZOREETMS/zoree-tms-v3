import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AuthApi, configureAuthHooks } from '../lib/api';
import { storage } from '../lib/storage';
import { API_BASE, SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

interface User {
  id?: string;
  email: string;
  role?: string;
  // QA P209 (2026-05-11): multi-role support mirrors the web's User
  // shape (REQ-08). `roles` is the full set assigned to this account;
  // `activeRole` is the one currently in effect. `role` is kept for
  // back-compat with callers that haven't been updated yet — it tracks
  // activeRole when present.
  roles?: string[];
  activeRole?: string;
  full_name?: string;
  user_metadata?: Record<string, unknown>;
}

interface AuthContextValue {
  user: User | null;
  booting: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ token: string; user: User }>;
  logout: () => void;
  /**
   * Force-refresh the access token using the stored refresh_token.
   * Returns the new bearer token, or null if refresh failed (caller
   * should re-prompt login). Mobile-bug 59.
   */
  refreshAccessToken: () => Promise<string | null>;
  /**
   * QA P209: switch the currently-active role without re-login.
   * Mirrors web's AuthContext.switchRole — validates against
   * `user.roles`, calls PATCH /auth/active-role, persists the
   * refreshed user object to storage.
   */
  switchRole: (nextRole: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Mobile-bug 59 fix lives entirely client-side: hit the same Supabase
 * endpoint /auth/v1/token?grant_type=refresh_token that server.js
 * /api/auth/login uses, swap the access_token + refresh_token, retry
 * the original request.
 *
 * Mobile-bug 60 follow-up: SUPABASE_URL / SUPABASE_ANON_KEY now come
 * from config/env.ts (EXPO_PUBLIC_* env vars at build time) so the
 * Realtime client and this refresh path share one source of truth.
 * The previous in-file '' constants meant a missing key silently
 * disabled both flows.
 */

/**
 * Refresh the Supabase access_token using the stored refresh_token.
 * Returns the new access_token (and side-effects: writes new tokens
 * to storage). Pure function-shaped so configureAuthHooks can call it
 * directly without any React context.
 */
async function performTokenRefresh(): Promise<string | null> {
  const refreshToken = storage.getItem('zoree_refresh_token');
  if (!refreshToken) return null;
  try {
    // Try the server-side proxy first. Older API builds don't have it
    // and will 404 - fall through to the direct Supabase call.
    const proxyBase = (typeof API_BASE === 'string' ? API_BASE : '').replace(/\/+$/, '');
    if (proxyBase) {
      const r = await fetch(`${proxyBase}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data?.access_token) {
          await storage.setItem('zoree_token', data.access_token);
          if (data.refresh_token) {
            await storage.setItem('zoree_refresh_token', data.refresh_token);
          }
          return data.access_token;
        }
      }
    }
  } catch {
    // proxy unreachable - try Supabase direct as a last resort.
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    if (!r.ok) return null;
    const data = await r.json().catch(() => ({}));
    if (data?.access_token) {
      await storage.setItem('zoree_token', data.access_token);
      if (data.refresh_token) {
        await storage.setItem('zoree_refresh_token', data.refresh_token);
      }
      return data.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    async function boot() {
      try {
        await storage.init();
        // Mobile-bug 59: register the 401 -> refresh hook BEFORE any
        // API call so a stale token at boot (e.g. user opened the app
        // after an hour) recovers transparently.
        configureAuthHooks({ onUnauthorized: performTokenRefresh });

        const t = storage.getItem('zoree_token');
        if (!t) {
          setBooting(false);
          return;
        }
        const rawUser = storage.getItem('zoree_user');
        if (rawUser) {
          try {
            setUser(JSON.parse(rawUser));
          } catch {
            // ignore parse error
          }
        }
        const res = await AuthApi.me();
        if (res?.user) {
          setUser(res.user);
        }
      } catch {
        await storage.removeItem('zoree_token');
        await storage.removeItem('zoree_refresh_token');
        await storage.removeItem('zoree_user');
        setUser(null);
      } finally {
        setBooting(false);
      }
    }
    boot();
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: !!user,
      async login(email: string, password: string) {
        const data = await AuthApi.login(email, password);
        await storage.setItem('zoree_token', data.token);
        if (data.refresh_token) {
          await storage.setItem('zoree_refresh_token', data.refresh_token);
        }
        await storage.setItem('zoree_user', JSON.stringify(data.user || null));
        setUser(data.user || null);
        return data;
      },
      async logout() {
        await storage.removeItem('zoree_token');
        await storage.removeItem('zoree_refresh_token');
        await storage.removeItem('zoree_user');
        setUser(null);
      },
      refreshAccessToken: performTokenRefresh,
      // QA P209 (2026-05-11): role switcher parity with web. Validates
      // that `nextRole` is in the user's assigned roles, hits the API,
      // and persists the refreshed user to storage so a relaunch keeps
      // the chosen role active. The shape of `setActiveRole`'s response
      // mirrors the web: { user: User }.
      async switchRole(nextRole: string): Promise<User> {
        if (!user) throw new Error('Not signed in');
        const assigned = Array.isArray(user.roles) ? user.roles : [];
        if (!assigned.includes(nextRole)) {
          throw new Error(`Role '${nextRole}' not assigned to this user`);
        }
        const res = await AuthApi.setActiveRole(nextRole);
        const next: User =
          res?.user || { ...user, role: nextRole, activeRole: nextRole };
        await storage.setItem('zoree_user', JSON.stringify(next));
        setUser(next);
        return next;
      },
    }),
    [user, booting],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
