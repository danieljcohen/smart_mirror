import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { FaceLogin } from "./components/FaceLogin";
import { RegisterFace } from "./components/RegisterFace";
import { LayoutEditor } from "./components/LayoutEditor";
import "./widgets";

type View = "login" | "register";

export default function App() {
  const { user, token, loading, loginWithFace, loginWithName, register, logout } = useAuth();
  const [view, setView] = useState<View>("login");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading...
      </div>
    );
  }

  if (user && token) {
    return <LayoutEditor token={token} userName={user.name} onLogout={logout} />;
  }

  if (view === "register") {
    return (
      <RegisterFace
        onRegister={register}
        onBack={() => setView("login")}
      />
    );
  }

  return (
    <FaceLogin
      onFaceCapture={loginWithFace}
      onNameLogin={loginWithName}
      onRegister={() => setView("register")}
    />
  );
}
