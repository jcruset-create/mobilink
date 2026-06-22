import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../services/supabase";

type RequireAuthProps = { children: React.ReactNode };

export default function RequireAuth({ children }: RequireAuthProps) {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session?.user);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return null;
  if (!authed) return <Navigate to="/almacen-neumaticos/login" replace />;
  return <>{children}</>;
}
