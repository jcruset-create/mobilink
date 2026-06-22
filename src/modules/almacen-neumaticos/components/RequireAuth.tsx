type RequireAuthProps = {
  children: React.ReactNode;
};

// Autenticación desactivada temporalmente
export default function RequireAuth({ children }: RequireAuthProps) {
  return <>{children}</>;
}
