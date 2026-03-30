import { useCallback, useState } from "react";

const USER_KEY = "mirror:user";

export function useUser() {
  const [name, setName] = useState<string | null>(() => localStorage.getItem(USER_KEY));

  const login = useCallback((userName: string) => {
    const trimmed = userName.trim();
    localStorage.setItem(USER_KEY, trimmed);
    setName(trimmed);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    setName(null);
  }, []);

  return { name, login, logout };
}
