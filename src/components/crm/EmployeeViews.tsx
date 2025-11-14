'use client';

import { Mail, Phone, Briefcase, Shield } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { useRouter } from 'next/navigation';

interface Employee {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  email: string;
  phone_number: string | null;
  avatar_url: string | null;
  avatar_metadata?: any;
  role: string;
  access_level: string;
  occupation: string | null;
  region: string | null;
  is_active: boolean;
  skills: string[] | null;
  order_index: number;
}

interface EmployeeViewProps {
  employees: Employee[];
  getRoleLabel: (role: string) => string;
  getAccessLevelLabel: (level: string) => string;
  getAccessLevelColor: (level: string) => string;
  canAddEmployee: boolean;
  onResetPassword?: (employee: Employee) => void;
}

export function EmployeeCardsView({
  employees,
  getRoleLabel,
  getAccessLevelLabel,
  getAccessLevelColor,
}: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {employees.map((employee) => (
        <div
          key={employee.id}
          onClick={() => router.push(`/crm/employees/${employee.id}`)}
          className="group cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/30"
        >
          <div className="mb-4 flex flex-col items-center text-center">
            <div className="mb-4">
              <EmployeeAvatar
                avatarUrl={employee.avatar_url}
                avatarMetadata={employee.avatar_metadata}
                employeeName={`${employee.name} ${employee.surname}`}
                size={80}
                className="border-2 border-[#d3bb73]/20 transition-colors group-hover:border-[#d3bb73]/40"
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
                {employee.phone_number}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmployeeListView({
  employees,
  getRoleLabel,
  getAccessLevelColor,
}: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-2">
      {employees.map((employee) => (
        <div
          key={employee.id}
          onClick={() => router.push(`/crm/employees/${employee.id}`)}
          className="flex cursor-pointer items-center gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/30"
        >
          <EmployeeAvatar
            avatarUrl={employee.avatar_url}
            avatarMetadata={employee.avatar_metadata}
            employeeName={`${employee.name} ${employee.surname}`}
            size={48}
            className="flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-medium text-[#e5e4e2]">
              {employee.nickname || employee.name}
              {!employee.nickname && ` ${employee.surname}`}
            </h3>
            <p className="truncate text-sm text-[#e5e4e2]/60">
              {employee.occupation || getRoleLabel(employee.role)}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                employee.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmployeeDetailedView({
  employees,
  getRoleLabel,
  getAccessLevelLabel,
  getAccessLevelColor,
}: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      {employees.map((employee) => (
        <div
          key={employee.id}
          onClick={() => router.push(`/crm/employees/${employee.id}`)}
          className="cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/30"
        >
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0">
              <EmployeeAvatar
                avatarUrl={employee.avatar_url}
                avatarMetadata={employee.avatar_metadata}
                employeeName={`${employee.name} ${employee.surname}`}
                size={96}
                className="border-2 border-[#d3bb73]/20"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-medium text-[#e5e4e2]">
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
                <span className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#e5e4e2]/40">
                  #{employee.order_index}
                </span>
              </div>

              <div className="mb-3 grid gap-3 md:grid-cols-2">
                <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <Mail className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                  <span className="truncate">{employee.email}</span>
                </div>
                {employee.phone_number && (
                  <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Phone className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                    {employee.phone_number}
                  </div>
                )}
                {employee.region && (
                  <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Briefcase className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                    {employee.region}
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
      ))}
    </div>
  );
}
