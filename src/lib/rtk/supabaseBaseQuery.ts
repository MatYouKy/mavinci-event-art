// lib/rtk/supabaseBaseQuery.ts
import type { BaseQueryFn } from "@reduxjs/toolkit/query";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/browser";

type SupabaseArgs =
  | { fn: "employees.list"; payload?: { activeOnly?: boolean } }
  | { fn: "employees_public_list"; payload?: { activeOnly?: boolean } }
  | { fn: "employees.byId"; payload: { id: string } }
  | { fn: "employees.byPermission"; payload: { permission: string } }
  | { fn: "employees.create"; payload: { data: any } }
  | { fn: "employees.updateById"; payload: { id: string; data: any } }
  | { fn: "employees.deleteById"; payload: { id: string } };

export const supabaseBaseQuery =
  (): BaseQueryFn<SupabaseArgs, unknown, { message: string; details?: any }> =>
  async (args) => {
    try {
      switch (args.fn) {
        /**
         * LISTA (bez RPC) - czyta bezpośrednio z tabeli employees + relacje
         * (wymaga poprawnych RLS/policies dla employees/employee_skills/skills)
         */
        case "employees.list": {
          const q = supabase
            .from("employees")
            .select(
              `
              *,
              employee_skills(
                id,
                skill_id,
                proficiency,
                skills(
                  id,
                  name,
                  description
                )
              )
            `,
            )
            .order("order_index", { ascending: true })
            .order("created_at", { ascending: false });

          const { data, error } =
            args.payload?.activeOnly === true ? await q.eq("is_active", true) : await q;

          if (error) throw error;
          return { data: data ?? [] };
        }

        /**
         * LISTA (RPC) - publiczna lista z Supabase function:
         * public.employees_public_list(...)
         * Używaj tego, jeśli RLS blokuje bezpośredni SELECT na tabeli.
         */
        case "employees_public_list": {
          // Funkcja w DB nie przyjmuje argumentów (args: ""),
          // więc NIE wolno wysyłać { activeOnly: ... } do rpc.
          const { data, error } = await supabase.rpc("employees_public_list");
        
          if (error) throw error;
        
          const list = (data as any[]) ?? [];
          const filtered =
            args.payload?.activeOnly === true ? list.filter((e) => e?.is_active === true) : list;
        
          return { data: filtered };
        }

        case "employees.byId": {
          const { data, error } = await supabase
            .from("employees")
            .select("*")
            .eq("id", args.payload.id)
            .single();

          if (error) throw error;
          return { data };
        }

        // ✅ Wariant A: relacja employee_permissions(employee_id, permission_key)
        case "employees.byPermission": {
          // 1) bierzemy employee_id z relacji
          const { data: rel, error: relErr } = await supabase
            .from("employee_permissions")
            .select("employee_id")
            .eq("permission_key", args.payload.permission);

          if (relErr) throw relErr;

          const ids = (rel ?? []).map((r: any) => r.employee_id).filter(Boolean);
          if (ids.length === 0) return { data: [] };

          // 2) dociągamy employees po id
          const { data, error } = await supabase
            .from("employees")
            .select("*")
            .in("id", ids)
            .order("order_index", { ascending: true })
            .order("created_at", { ascending: false });

          if (error) throw error;
          return { data: data ?? [] };
        }

        case "employees.create": {
          const { data, error } = await supabase
            .from("employees")
            .insert([args.payload.data])
            .select("*")
            .single();

          if (error) throw error;
          return { data };
        }

        case "employees.updateById": {
          const { data, error } = await supabase
            .from("employees")
            .update(args.payload.data)
            .eq("id", args.payload.id)
            .select("*")
            .single();

          if (error) throw error;
          return { data };
        }

        case "employees.deleteById": {
          const { error } = await supabase.from("employees").delete().eq("id", args.payload.id);

          if (error) throw error;
          return { data: { ok: true } };
        }

        default:
          // żebyś od razu widział co przyszło w args.fn
          return { error: { message: `Unsupported operation: ${(args as any)?.fn}` } };
      }
    } catch (e) {
      const err = e as PostgrestError | any;
      return { error: { message: err?.message ?? "Supabase error", details: err } };
    }
  };