// app/crm/employees/api/employeesApi.ts
import { createApi } from "@reduxjs/toolkit/query/react";
import { supabaseBaseQuery } from "@/lib/rtk/supabaseBaseQuery";
import type { EmployeeCreateDTO, EmployeeUpdateDTO, IEmployee } from "../type";

export const employeesApi = createApi({
  reducerPath: "employeesApi",
  baseQuery: supabaseBaseQuery(),
  tagTypes: ["Employees", "Employee", "EmployeesByPermission"],
  endpoints: (builder) => ({
    getEmployees: builder.query<IEmployee[], { activeOnly?: boolean }>({
      query: (arg = {}) => ({ fn: "employees.list", payload: arg }),
      providesTags: (result) =>
        result
          ? [
              { type: "Employees", id: "LIST" },
              ...result.map((e) => ({ type: "Employee" as const, id: e.id })),
            ]
          : [{ type: "Employees", id: "LIST" }],
    }),

    getEmployeeById: builder.query<IEmployee, string>({
      query: (id) => ({ fn: "employees.byId", payload: { id } }),
      providesTags: (_res, _err, id) => [{ type: "Employee", id }],
    }),

    getEmployeesByPermission: builder.query<IEmployee[], string>({
      query: (permission) => ({ fn: "employees.byPermission", payload: { permission } }),
      providesTags: (_res, _err, permission) => [
        { type: "EmployeesByPermission", id: permission },
      ],
    }),

    createEmployee: builder.mutation<IEmployee, EmployeeCreateDTO>({
      query: (data) => ({ fn: "employees.create", payload: { data } }),
      invalidatesTags: [{ type: "Employees", id: "LIST" }],
    }),

    updateEmployeeById: builder.mutation<IEmployee, { id: string; data: EmployeeUpdateDTO }>({
      query: ({ id, data }) => ({ fn: "employees.updateById", payload: { id, data } }),
      invalidatesTags: (_res, _err, arg) => [
        { type: "Employees", id: "LIST" },
        { type: "Employee", id: arg.id },
      ],
    }),

    deleteEmployeeById: builder.mutation<{ ok: true }, string>({
      query: (id) => ({ fn: "employees.deleteById", payload: { id } }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Employees", id: "LIST" },
        { type: "Employee", id },
      ],
    }),
  }),
});

export const {
  useGetEmployeesQuery,
  useGetEmployeeByIdQuery,
  useGetEmployeesByPermissionQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeByIdMutation,
  useDeleteEmployeeByIdMutation,
} = employeesApi;