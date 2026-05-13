'use client';


import { Mail, Phone, Briefcase, Shield, Key, Trash2, Loader2, Eye } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { useRouter } from 'next/navigation';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { useAuth } from '@/contexts/AuthContext';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

interface EmployeeViewProps {
  employees: IEmployee[];
  getRoleLabel: (role: string) => string;
  getAccessLevelLabel: (level: string) => string;
  getAccessLevelColor: (level: string) => string;
  canAddEmployee: boolean;
  canViewEmployees: boolean;
  isAdmin?: boolean;
  onResetPassword?: (employee: IEmployee) => void;
  onDeleteEmployee?: (employee: IEmployee) => void;
  deletingEmployeeId?: string | null;
}

export function employeeActions(router: ReturnType<typeof useRouter>, {
  employee,
  isAdmin,
  onResetPassword,
  onDeleteEmployee,
  deletingEmployeeId,
}: {
  employee: IEmployee;
  isAdmin?: boolean;
  onResetPassword?: (employee: IEmployee) => void;
  onDeleteEmployee?: (employee: IEmployee) => void;
  deletingEmployeeId?: string | null;
}) {
  const isDeleting = deletingEmployeeId === employee.id;

  const actions: Action[] = [
    {
      label: 'Szczegóły',
      onClick: () => router.push(`/crm/employees/${employee.id}`),
      icon: <Eye className="h-4 w-4" />,
      variant: 'default',
    },
    {
      label: 'Resetuj hasło',
      onClick: () => onResetPassword?.(employee),
      icon: <Key className="h-4 w-4" />,
      variant: 'default',
      show: isAdmin === true && !!onResetPassword,
      disabled: !!deletingEmployeeId,
    },
    {
      label: isDeleting ? 'Usuwanie...' : 'Usuń',
      onClick: () => onDeleteEmployee?.(employee),
      icon: isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      ),
      variant: 'danger',
      show: isAdmin === true && !!onDeleteEmployee,
      disabled: !!deletingEmployeeId,
    },
  ];

  return actions;
}

export function EmployeeCardsView({
  employees,
  getRoleLabel,
  getAccessLevelLabel,
  getAccessLevelColor,
  isAdmin,
  canViewEmployees,
  onResetPassword,
  onDeleteEmployee,
  deletingEmployeeId,
}: EmployeeViewProps) {
  const router = useRouter();
  useAuth();

  if (!canViewEmployees) {
    return (
      <div className="text-center text-sm text-red-400">
        Nie masz uprawnień do przeglądania pracowników
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {employees.map((employee) => {
        const actions = employeeActions(router, {
          employee,
          isAdmin,
          onResetPassword,
          onDeleteEmployee,
          deletingEmployeeId,
        });

        return (
          <div
            key={employee.id}
            className="group relative rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/30"
          >
            <div className="absolute right-3 top-3 z-10">
              <ResponsiveActionBar actions={actions} disabledBackground mobileBreakpoint={4000} />
            </div>

            <div className="mb-4 flex flex-col items-center text-center">
              <div
                className="mb-4 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/crm/employees/${employee.id}`);
                }}
              >
                <EmployeeAvatar
                  employee={employee}
                  size={80}
                  className="border-2 border-[#d3bb73]/20 transition-colors group-hover:border-[#d3bb73]/40"
                  showActivityStatus
                />
              </div>

              <h3 className="text-lg font-medium text-[#e5e4e2]">
                {employee.nickname || employee.name}
              </h3>

              {employee.nickname && (
                <p className="mb-1 text-xs text-[#e5e4e2]/40">
                  {employee.name} {employee.surname}
                </p>
              )}

              <p className="mb-2 text-sm text-[#d3bb73]">
                {employee.occupation || getRoleLabel(employee.role)}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs ${
                    employee.is_active
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
                </span>

                <span
                  className={`rounded-full px-3 py-1 text-xs ${getAccessLevelColor(
                    employee.access_level,
                  )}`}
                >
                  <Shield className="mr-1 inline h-3 w-3" />
                  {getAccessLevelLabel(employee.access_level)}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{employee.email}</span>
              </div>

              {employee.phone_number && (
                <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                  <Phone className="h-4 w-4 flex-shrink-0" />
                  <span>{employee.phone_number}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EmployeeListView({
  employees,
  getRoleLabel,
  isAdmin,
  onResetPassword,
  onDeleteEmployee,
  deletingEmployeeId,
}: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-2">
      {employees.map((employee) => {
        const actions = employeeActions(router, {
          employee,
          isAdmin,
          onResetPassword: onResetPassword || undefined,
          onDeleteEmployee: onDeleteEmployee || undefined,
          deletingEmployeeId: deletingEmployeeId || undefined,
        });

        return (
          <div
            key={employee.id}
            className="flex items-center gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/30"
          >
            <div
              className="flex-shrink-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/crm/employees/${employee.id}`);
              }}
            >
              <EmployeeAvatar
                employee={employee}
                size={64}
                className="border-2 border-[#d3bb73]/20 transition-colors group-hover:border-[#d3bb73]/40"
                showActivityStatus
              />
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-medium text-[#e5e4e2]">
                {employee.nickname || employee.name}
                {!employee.nickname && ` ${employee.surname}`}
              </h3>

              <p className="truncate text-sm text-[#e5e4e2]/60">
                {employee.occupation || getRoleLabel(employee.role)}
              </p>
            </div>

            <div className="hidden flex-shrink-0 items-center gap-2 sm:flex">
              <span
                className={`rounded-full px-3 py-1 text-xs ${
                  employee.is_active
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
              </span>
            </div>

            <ResponsiveActionBar actions={actions} disabledBackground mobileBreakpoint={4000} />
          </div>
        );
      })}
    </div>
  );
}

export function EmployeeDetailedView({
  employees,
  getRoleLabel,
  getAccessLevelLabel,
  getAccessLevelColor,
  isAdmin,
  onResetPassword,
  onDeleteEmployee,
  deletingEmployeeId,
}: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      {employees.map((employee) => {
        const actions = employeeActions(router, {
          employee,
          isAdmin,
          onResetPassword,
          onDeleteEmployee,
          deletingEmployeeId,
        });

        return (
          <div
            key={employee.id}
            className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/30 md:p-6"
          >
            <div className="flex items-start gap-4 md:gap-6">
              <div
                className="flex-shrink-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/crm/employees/${employee.id}`);
                }}
              >
                <EmployeeAvatar
                  employee={employee}
                  size={80}
                  className="border-2 border-[#d3bb73]/20 transition-colors group-hover:border-[#d3bb73]/40"
                  showActivityStatus
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-xl font-medium text-[#e5e4e2]">
                      {employee.nickname || `${employee.name} ${employee.surname}`}
                    </h3>

                    {employee.nickname && (
                      <p className="text-sm text-[#e5e4e2]/40">
                        {employee.name} {employee.surname}
                      </p>
                    )}

                    <p className="mt-1 text-base text-[#d3bb73]">
                      {employee.occupation || getRoleLabel(employee.role)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="hidden rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#e5e4e2]/40 md:inline-flex">
                      #{employee.order_index}
                    </span>

                    <ResponsiveActionBar actions={actions} disabledBackground mobileBreakpoint={4000} />
                  </div>
                </div>

                <div className="mb-3 grid gap-3 md:grid-cols-2">
                  <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Mail className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                    <span className="truncate">{employee.email}</span>
                  </div>

                  {employee.phone_number && (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                      <Phone className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                      <span>{employee.phone_number}</span>
                    </div>
                  )}

                  {employee.region && (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                      <Briefcase className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                      <span>{employee.region}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${
                      employee.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
                  </span>

                  <span
                    className={`rounded-full px-3 py-1 text-xs ${getAccessLevelColor(
                      employee.access_level,
                    )}`}
                  >
                    <Shield className="mr-1 inline h-3 w-3" />
                    {getAccessLevelLabel(employee.access_level)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}