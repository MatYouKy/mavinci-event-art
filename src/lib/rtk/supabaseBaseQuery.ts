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
         * UWAGA:
         * - W DB masz public.employees_public_list() bez parametrów.
         * - Dlatego RPC wołamy bez args, a activeOnly filtrujemy w JS.
         *
         * Dodatkowo: "employees.list" mapujemy na public listę,
         * żeby hook useEmployees({activeOnly:false}) zawsze działał.
         */
        case "employees.list":
        case "employees_public_list": {
          const { data, error } = await supabase.rpc("employees_public_list");

          if (error) throw error;

          const rows = (data ?? []) as any[];
          const activeOnly = args.payload?.activeOnly === true;

          return {
            data: activeOnly ? rows.filter((r) => r?.is_active === true) : rows,
          };
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
          const { data: rel, error: relErr } = await supabase
            .from("employee_permissions")
            .select("employee_id")
            .eq("permission_key", args.payload.permission);

          if (relErr) throw relErr;

          const ids = (rel ?? []).map((r: any) => r.employee_id).filter(Boolean);
          if (ids.length === 0) return { data: [] };

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
          const { error } = await supabase
            .from("employees")
            .delete()
            .eq("id", args.payload.id);

          if (error) throw error;
          return { data: { ok: true } };
        }

        default:
          return { error: { message: "Unsupported operation" } };
      }
    } catch (e) {
      const err = e as PostgrestError | any;
      return { error: { message: err?.message ?? "Supabase error", details: err } };
    }
  };