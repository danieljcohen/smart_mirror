import { useAuth } from "./hooks/useAuth";
import { FaceLogin } from "./components/FaceLogin";
import { LayoutEditor } from "./components/LayoutEditor";
import "./widgets";

export default function App() {
  const { user, token, loading, loginWithFace, loginWithName, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading...
      </div>
    );
  }

  if (!user || !token) {
    return <FaceLogin onFaceCapture={loginWithFace} onNameLogin={loginWithName} />;
  }

  return <LayoutEditor token={token} userName={user.name} onLogout={logout} />;
}
