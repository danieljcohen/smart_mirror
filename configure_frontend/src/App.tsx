import { useState } from "react";
import { useUser } from "./hooks/useUser";
import { NameEntry } from "./components/NameEntry";
import { LayoutEditor } from "./components/LayoutEditor";
import { RegisterFace } from "./components/RegisterFace";
import "./widgets";

type View = "login" | "editor" | "register";

export default function App() {
  const { name, login, logout } = useUser();
  const [view, setView] = useState<View>(name ? "editor" : "login");

  const handleLogin = (userName: string) => {
    login(userName);
    setView("editor");
  };

  const handleLogout = () => {
    logout();
    setView("login");
  };

  const handleRegisterSuccess = (registeredName: string) => {
    login(registeredName);
    setView("editor");
  };

  if (view === "register") {
    return (
      <RegisterFace
        defaultName={name ?? ""}
        onBack={() => setView(name ? "editor" : "login")}
        onSuccess={handleRegisterSuccess}
      />
    );
  }

  if (!name || view === "login") {
    return (
      <NameEntry
        onLogin={handleLogin}
        onRegister={() => setView("register")}
      />
    );
  }

  return (
    <LayoutEditor
      userName={name}
      onLogout={handleLogout}
      onRegister={() => setView("register")}
    />
  );
}
