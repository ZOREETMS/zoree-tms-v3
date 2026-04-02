import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AuthApi } from '../lib/api';
import { storage } from '../lib/storage';

interface User {
  id?: string;
  email: string;
  role?: string;
  full_name?: string;
  user_metadata?: Record<string, unknown>;
}

interface AuthContextValue {
  user: User | null;
  booting: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ token: string; user: User }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    async function boot() {
      try {
        await storage.init();
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
        await storage.setItem('zoree_user', JSON.stringify(data.user || null));
        setUser(data.user || null);
        return data;
      },
      async logout() {
        await storage.removeItem('zoree_token');
        await storage.removeItem('zoree_user');
        setUser(null);
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
