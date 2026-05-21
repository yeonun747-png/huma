'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

interface AuthState {
  token: string | null;
  admin: { name: string; email?: string; workspaces: string[]; isSuper?: boolean } | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  admin: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AuthState['admin']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem('huma_token');
    if (t) {
      setToken(t);
      api.me()
        .then((me) =>
          setAdmin({
            name: '관리자',
            email: me.email,
            workspaces: me.workspaces,
            isSuper: me.isSuper,
          }),
        )
        .catch(() => {
          localStorage.removeItem('huma_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.login(username, password);
    localStorage.setItem('huma_token', res.token);
    setToken(res.token);
    setAdmin({
      name: res.admin.name,
      email: res.admin.email,
      workspaces: res.admin.workspaces,
      isSuper: res.admin.isSuper,
    });
  };

  const logout = () => {
    localStorage.removeItem('huma_token');
    localStorage.removeItem('huma_workspace');
    setToken(null);
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ token, admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
