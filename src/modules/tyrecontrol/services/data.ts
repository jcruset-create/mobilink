import { supabase } from "./supabase";
import type { Empresa, Perfil, Rol } from "../types";

// ── Empresas ─────────────────────────────────────────────────
export async function listarEmpresas(): Promise<Empresa[]> {
  const { data, error } = await supabase.from("empresas").select("*").order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Empresa[];
}

export async function crearEmpresa(input: Pick<Empresa, "nombre" | "cif" | "telefono" | "email">): Promise<void> {
  const { error } = await supabase.from("empresas").insert({
    nombre: input.nombre.trim(),
    cif: input.cif?.trim() || null,
    telefono: input.telefono?.trim() || null,
    email: input.email?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function actualizarEmpresa(id: string, patch: Partial<Empresa>): Promise<void> {
  const { error } = await supabase.from("empresas").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Usuarios ─────────────────────────────────────────────────
export async function listarUsuarios(): Promise<Perfil[]> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("*, empresa:empresas(*)")
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Perfil[];
}

export type NuevoUsuario = {
  nombre: string;
  email: string;
  password: string;
  rol: Rol;
  acceso_apk: boolean;
  acceso_panel: boolean;
  empresa_id?: string; // solo super-admin
};

export async function crearUsuario(input: NuevoUsuario): Promise<void> {
  // Alta privilegiada vía Edge Function (service_role)
  const { data, error } = await supabase.functions.invoke("crear-usuario", { body: input });
  if (error) throw new Error(error.message);
  if (data && (data as any).error) throw new Error((data as any).error);
}

export async function actualizarUsuario(id: string, patch: Partial<Perfil>): Promise<void> {
  const { error } = await supabase
    .from("usuarios")
    .update({
      nombre: patch.nombre,
      rol: patch.rol,
      activo: patch.activo,
      acceso_apk: patch.acceso_apk,
      acceso_panel: patch.acceso_panel,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
