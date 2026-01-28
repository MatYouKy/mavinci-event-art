import { createApi } from '@reduxjs/toolkit/query/react';
import { supabaseBaseQuery } from '@/lib/rtk/supabaseBaseQuery';

export interface Database {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatabaseColumn {
  id: string;
  database_id: string;
  name: string;
  column_type: 'text' | 'number' | 'date' | 'boolean';
  order_index: number;
  created_at: string;
}

export interface DatabaseRecord {
  id: string;
  database_id: string;
  data: Record<string, any>;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDatabaseInput {
  name: string;
  description?: string;
}

export interface CreateColumnInput {
  database_id: string;
  name: string;
  column_type: 'text' | 'number' | 'date' | 'boolean';
  order_index?: number;
}

export interface CreateRecordInput {
  database_id: string;
  data: Record<string, any>;
  order_index?: number;
}

export const databasesApi = createApi({
  reducerPath: 'databasesApi',
  baseQuery: supabaseBaseQuery,
  tagTypes: ['Database', 'DatabaseColumn', 'DatabaseRecord'],
  endpoints: (builder) => ({
    getDatabases: builder.query<Database[], void>({
      query: () => ({
        table: 'custom_databases',
        method: 'select',
        select: '*',
        order: { column: 'created_at', ascending: false },
      }),
      providesTags: ['Database'],
    }),

    getDatabaseById: builder.query<Database, string>({
      query: (id) => ({
        table: 'custom_databases',
        method: 'select',
        select: '*',
        match: { id },
        single: true,
      }),
      providesTags: (result, error, id) => [{ type: 'Database', id }],
    }),

    getDatabaseColumns: builder.query<DatabaseColumn[], string>({
      query: (databaseId) => ({
        table: 'custom_database_columns',
        method: 'select',
        select: '*',
        match: { database_id: databaseId },
        order: { column: 'order_index', ascending: true },
      }),
      providesTags: (result, error, databaseId) => [
        { type: 'DatabaseColumn', id: databaseId },
      ],
    }),

    getDatabaseRecords: builder.query<DatabaseRecord[], string>({
      query: (databaseId) => ({
        table: 'custom_database_records',
        method: 'select',
        select: '*',
        match: { database_id: databaseId },
        order: { column: 'order_index', ascending: true },
      }),
      providesTags: (result, error, databaseId) => [
        { type: 'DatabaseRecord', id: databaseId },
      ],
    }),

    createDatabase: builder.mutation<Database, CreateDatabaseInput>({
      query: (data) => ({
        table: 'custom_databases',
        method: 'insert',
        data: {
          ...data,
          created_by: 'auth.uid()',
        },
      }),
      invalidatesTags: ['Database'],
    }),

    updateDatabase: builder.mutation<
      Database,
      { id: string; data: Partial<CreateDatabaseInput> }
    >({
      query: ({ id, data }) => ({
        table: 'custom_databases',
        method: 'update',
        data,
        match: { id },
      }),
      invalidatesTags: (result, error, { id }) => [
        'Database',
        { type: 'Database', id },
      ],
    }),

    deleteDatabase: builder.mutation<void, string>({
      query: (id) => ({
        table: 'custom_databases',
        method: 'delete',
        match: { id },
      }),
      invalidatesTags: ['Database'],
    }),

    createColumn: builder.mutation<DatabaseColumn, CreateColumnInput>({
      query: (data) => ({
        table: 'custom_database_columns',
        method: 'insert',
        data,
      }),
      invalidatesTags: (result, error, { database_id }) => [
        { type: 'DatabaseColumn', id: database_id },
      ],
    }),

    updateColumn: builder.mutation<
      DatabaseColumn,
      { id: string; data: Partial<CreateColumnInput> }
    >({
      query: ({ id, data }) => ({
        table: 'custom_database_columns',
        method: 'update',
        data,
        match: { id },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'DatabaseColumn', id },
      ],
    }),

    deleteColumn: builder.mutation<void, { id: string; database_id: string }>({
      query: ({ id }) => ({
        table: 'custom_database_columns',
        method: 'delete',
        match: { id },
      }),
      invalidatesTags: (result, error, { database_id }) => [
        { type: 'DatabaseColumn', id: database_id },
        { type: 'DatabaseRecord', id: database_id },
      ],
    }),

    createRecord: builder.mutation<DatabaseRecord, CreateRecordInput>({
      query: (data) => ({
        table: 'custom_database_records',
        method: 'insert',
        data,
      }),
      invalidatesTags: (result, error, { database_id }) => [
        { type: 'DatabaseRecord', id: database_id },
      ],
    }),

    updateRecord: builder.mutation<
      DatabaseRecord,
      { id: string; database_id: string; data: Record<string, any> }
    >({
      query: ({ id, data }) => ({
        table: 'custom_database_records',
        method: 'update',
        data: { data },
        match: { id },
      }),
      invalidatesTags: (result, error, { database_id }) => [
        { type: 'DatabaseRecord', id: database_id },
      ],
    }),

    deleteRecord: builder.mutation<void, { id: string; database_id: string }>({
      query: ({ id }) => ({
        table: 'custom_database_records',
        method: 'delete',
        match: { id },
      }),
      invalidatesTags: (result, error, { database_id }) => [
        { type: 'DatabaseRecord', id: database_id },
      ],
    }),

    reorderColumns: builder.mutation<
      void,
      { database_id: string; columns: { id: string; order_index: number }[] }
    >({
      async queryFn({ columns }, api, extraOptions, baseQuery) {
        for (const col of columns) {
          await baseQuery({
            table: 'custom_database_columns',
            method: 'update',
            data: { order_index: col.order_index },
            match: { id: col.id },
          });
        }
        return { data: undefined };
      },
      invalidatesTags: (result, error, { database_id }) => [
        { type: 'DatabaseColumn', id: database_id },
      ],
    }),
  }),
});

export const {
  useGetDatabasesQuery,
  useGetDatabaseByIdQuery,
  useGetDatabaseColumnsQuery,
  useGetDatabaseRecordsQuery,
  useCreateDatabaseMutation,
  useUpdateDatabaseMutation,
  useDeleteDatabaseMutation,
  useCreateColumnMutation,
  useUpdateColumnMutation,
  useDeleteColumnMutation,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useDeleteRecordMutation,
  useReorderColumnsMutation,
} = databasesApi;
