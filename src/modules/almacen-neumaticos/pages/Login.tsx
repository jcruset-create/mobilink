import { useEffect } from "react";

export default function Login() {
  useEffect(() => {
    window.location.href = "/almacen-neumaticos";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-gray-400 text-sm">Redirigiendo...</p>
    </div>
  );
}
