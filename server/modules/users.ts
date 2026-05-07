export type UserRole = "admin" | "supervisor" | "pantallas";

type AppUser = {
  role: UserRole;
  password?: string;
};

export function getUsers(): AppUser[] {
  return [
    {
      role: "admin",
      password: process.env.ADMIN_PASSWORD,
    },
    {
      role: "supervisor",
      password: process.env.SUPERVISOR_PASSWORD,
    },
    {
      role: "pantallas",
      password: process.env.SCREENS_PASSWORD,
    },
  ];
}

export function findUserByPassword(password: string | undefined) {
  if (!password) return null;

  const users = getUsers();

  return (
    users.find((user) => user.password && password === user.password) ?? null
  );
}