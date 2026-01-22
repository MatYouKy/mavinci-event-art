// app/crm/employees/hook/useEmployees.ts
"use client";

import {
  useCreateEmployeeMutation,
  useDeleteEmployeeByIdMutation,
  useGetEmployeeByIdQuery,
  useGetEmployeesByPermissionQuery,
  useGetEmployeesQuery,
  useUpdateEmployeeByIdMutation,
} from "../store/employeeApi";
import type { EmployeeCreateDTO, EmployeeUpdateDTO } from "../type";

export const useEmployees = (opts?: { activeOnly?: boolean }) => {
  // list
  const listQuery = useGetEmployeesQuery(opts ?? {});
  const { data: list = [], isLoading: listLoading, isFetching: listFetching, error: listError } =
    listQuery;

  // mutations
  const [createEmployee, createState] = useCreateEmployeeMutation();
  const [updateEmployee, updateState] = useUpdateEmployeeByIdMutation();
  const [deleteEmployee, deleteState] = useDeleteEmployeeByIdMutation();

  // “helper-y” jako funkcje (RTKQ pod spodem)
  const create = (data: EmployeeCreateDTO) => createEmployee(data).unwrap();
  const updateById = (id: string, data: EmployeeUpdateDTO) =>
    updateEmployee({ id, data }).unwrap();
  const deleteById = (id: string) => deleteEmployee(id).unwrap();

  // getById i byPermission jako “factory hooks”
  // (nie da się odpalać hooków warunkowo jako zwykłe funkcje, więc dajemy helpery)
  const useById = (id: string | null) =>
    useGetEmployeeByIdQuery(id as string, { skip: !id });

  const useByPermission = (permission: string | null) =>
    useGetEmployeesByPermissionQuery(permission as string, { skip: !permission });

  return {
    // list
    list,
    loading: listLoading || listFetching,
    error: listError,

    // crud
    create,
    updateById,
    deleteById,

    // states (do UI)
    createState,
    updateState,
    deleteState,

    // detail helpers
    useById,
    useByPermission,
  };
};

//Use Case:

/*
Lista:
const { list: employees, loading } = useEmployees({ activeOnly: true });

Pracownik po id (w komponencie detali):
const { useById } = useEmployees();
const { data: employee, isLoading } = useById(employeeId);

Pracownicy po permission:
const { useByPermission } = useEmployees();
const { data: managers = [] } = useByPermission("employees.manage");

CRUD:
const { create, updateById, deleteById } = useEmployees();

await create({ name: "Jan", surname: "Kowalski", email: "..."  });
await updateById(id, { phone_number: "+48..." });
await deleteById(id);

*/