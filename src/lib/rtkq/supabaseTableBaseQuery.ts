// lib/rtk/supabaseTableBaseQuery.ts
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/browser';

type OrderBy = { column: string; ascending?: boolean };

export type SupabaseTableArgs =
  | {
      table: string;
      method: 'select';
      select?: string;
      match?: Record<string, any>;
      in?: { column: string; values: any[] };
      order?: OrderBy | OrderBy[];
      single?: boolean;
    }
  | {
      table: string;
      method: 'insert';
      data: any;
      select?: string;
      single?: boolean;
    }
  | {
      table: string;
      method: 'update';
      data: any;
      match: Record<string, any>;
      select?: string;
      single?: boolean;
    }
  | {
      table: string;
      method: 'delete';
      match: Record<string, any>;
    };

export const supabaseTableBaseQuery =
  (): BaseQueryFn<SupabaseTableArgs, unknown, { message: string; details?: any }> =>
  async (args) => {
    try {
      const selectStr = args.method === 'select' ? args.select ?? '*' : (args as any).select ?? '*';

      // helper: apply order (single or array)
      const applyOrder = (q: any, order?: OrderBy | OrderBy[]) => {
        if (!order) return q;
        const arr = Array.isArray(order) ? order : [order];
        let qq = q;
        for (const o of arr) {
          qq = qq.order(o.column, { ascending: o.ascending ?? true });
        }
        return qq;
      };

      if (args.method === 'select') {
        let q: any = supabase.from(args.table).select(selectStr);

        if (args.match) q = q.match(args.match);
        if (args.in) q = q.in(args.in.column, args.in.values);

        q = applyOrder(q, args.order);

        if (args.single) {
          const { data, error } = await q.single();
          if (error) throw error;
          return { data };
        }

        const { data, error } = await q;
        if (error) throw error;
        return { data: data ?? [] };
      }

      if (args.method === 'insert') {
        let q: any = supabase.from(args.table).insert([args.data]).select(selectStr);
        if (args.single) q = q.single();

        const { data, error } = await q;
        if (error) throw error;
        return { data };
      }

      if (args.method === 'update') {
        let q: any = supabase.from(args.table).update(args.data).match(args.match).select(selectStr);
        if (args.single) q = q.single();

        const { data, error } = await q;
        if (error) throw error;
        return { data };
      }

      if (args.method === 'delete') {
        const { error } = await supabase.from(args.table).delete().match(args.match);
        if (error) throw error;
        return { data: { ok: true } };
      }

      return { error: { message: 'Unsupported operation' } };
    } catch (e) {
      const err = e as PostgrestError | any;
      return { error: { message: err?.message ?? 'Supabase error', details: err } };
    }
  };