'use client';

import { Mail, Phone, Briefcase, Shield, Key } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { useRouter } from 'next/navigation';
import { IEmployee } from '@/app/crm/employees/type';

interface EmployeeViewProps {
  employees: IEmployee[];
  getRoleLabel: (role: string) => string;
  getAccessLevelLabel: (level: string) => string;
  getAccessLevelColor: (level: string) => string;
  canAddEmployee: boolean;
  isAdmin?: boolean;
  onResetPassword?: (employee: IEmployee) => void;
}

export function EmployeeCardsView({ employees, getRoleLabel, getAccessLevelLabel, getAccessLevelColor, isAdmin, onResetPassword }: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {employees.map((employee) => (
        <div
          key={employee.id}
          className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all group"
        >
          <div className="flex flex-col items-center text-center mb-4">
            <div className="mb-4">
              <EmployeeAvatar
                avatarUrl={employee.avatar_url}
                avatarMetadata={employee.avatar_metadata}
                employeeName={`${employee.name} ${employee.surname}`}
                size={80}
                className="border-2 border-[#d3bb73]/20 group-hover:border-[#d3bb73]/40 transition-colors"
                showActivityStatus={true}
                lastActiveAt={employee.last_active_at}
              />
            </div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">
              {employee.nickname || employee.name}
            </h3>
            {employee.nickname && (
              <p className="text-xs text-[#e5e4e2]/40 mb-1">
                {employee.name} {employee.surname}
              </p>
            )}
            <p className="text-sm text-[#d3bb73] mb-2">
              {employee.occupation || getRoleLabel(employee.role)}
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <span
                className={`px-3 py-1 rounded-full text-xs ${
                  employee.is_active
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs ${getAccessLevelColor(
                  employee.access_level
                )}`}
              >
                <Shield className="w-3 h-3 inline mr-1" />
                {getAccessLevelLabel(employee.access_level)}
              </span>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-[#e5e4e2]/70">
              <Mail className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{employee.email}</span>
            </div>
            {employee.phone_number && (
              <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                <Phone className="w-4 h-4 flex-shrink-0" />
                {employee.phone_number}
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/crm/employees/${employee.id}`);
              }}
              className="flex-1 px-3 py-2 text-xs bg-[#d3bb73]/10 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
            >
              Szczegóły
            </button>
            {isAdmin && onResetPassword && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResetPassword(employee);
                }}
                className="px-3 py-2 text-xs bg-orange-500/10 text-orange-400 rounded-lg hover:bg-orange-500/20 transition-colors flex items-center gap-1"
                title="Resetuj hasło"
              >
                <Key className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmployeeListView({ employees, getRoleLabel, getAccessLevelColor, isAdmin, onResetPassword }: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-2">
      {employees.map((employee) => (
        <div
          key={employee.id}
          className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-all flex items-center gap-4"
        >
          <EmployeeAvatar
            avatarUrl={employee.avatar_url}
            avatarMetadata={employee.avatar_metadata}
            employeeName={`${employee.name} ${employee.surname}`}
            size={48}
            className="flex-shrink-0"
            showActivityStatus={true}
            lastActiveAt={employee.last_active_at}
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-medium text-[#e5e4e2] truncate">
              {employee.nickname || employee.name}
              {!employee.nickname && ` ${employee.surname}`}
            </h3>
            <p className="text-sm text-[#e5e4e2]/60 truncate">
              {employee.occupation || getRoleLabel(employee.role)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`px-3 py-1 rounded-full text-xs ${
                employee.is_active
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/crm/employees/${employee.id}`);
              }}
              className="px-3 py-1.5 text-xs bg-[#d3bb73]/10 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
            >
              Szczegóły
            </button>
            {isAdmin && onResetPassword && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResetPassword(employee);
                }}
                className="p-1.5 text-xs bg-orange-500/10 text-orange-400 rounded-lg hover:bg-orange-500/20 transition-colors"
                title="Resetuj hasło"
              >
                <Key className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmployeeDetailedView({ employees, getRoleLabel, getAccessLevelLabel, getAccessLevelColor, isAdmin, onResetPassword }: EmployeeViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      {employees.map((employee) => (
        <div
          key={employee.id}
          className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all"
        >
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0">
              <EmployeeAvatar
                avatarUrl={employee.avatar_url}
                avatarMetadata={employee.avatar_metadata}
                employeeName={`${employee.name} ${employee.surname}`}
                size={96}
                className="border-2 border-[#d3bb73]/20"
                showActivityStatus={true}
                lastActiveAt={employee.last_active_at}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-xl font-medium text-[#e5e4e2]">
                    {employee.nickname || `${employee.name} ${employee.surname}`}
                  </h3>
                  {employee.nickname && (
                    <p className="text-sm text-[#e5e4e2]/40">
                      {employee.name} {employee.surname}
                    </p>
                  )}
                  <p className="text-base text-[#d3bb73] mt-1">
                    {employee.occupation || getRoleLabel(employee.role)}
                  </p>
                </div>
                <span className="text-xs text-[#e5e4e2]/40 bg-[#d3bb73]/10 px-3 py-1 rounded-full">
                  #{employee.order_index}
                </span>
              </div>

              <div className="grid md:grid-cols-2 gap-3 mb-3">
                <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <Mail className="w-4 h-4 flex-shrink-0 text-[#d3bb73]" />
                  <span className="truncate">{employee.email}</span>
                </div>
                {employee.phone_number && (
                  <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Phone className="w-4 h-4 flex-shrink-0 text-[#d3bb73]" />
                    {employee.phone_number}
                  </div>
                )}
                {employee.region && (
                  <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Briefcase className="w-4 h-4 flex-shrink-0 text-[#d3bb73]" />
                    {employee.region}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-3 py-1 rounded-full text-xs ${
                    employee.is_active
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs ${getAccessLevelColor(
                    employee.access_level
                  )}`}
                >
                  <Shield className="w-3 h-3 inline mr-1" />
                  {getAccessLevelLabel(employee.access_level)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/crm/employees/${employee.id}`);
                  }}
                  className="px-4 py-1.5 text-xs bg-[#d3bb73]/10 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
                >
                  Szczegóły
                </button>
                {isAdmin && onResetPassword && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onResetPassword(employee);
                    }}
                    className="px-3 py-1.5 text-xs bg-orange-500/10 text-orange-400 rounded-lg hover:bg-orange-500/20 transition-colors flex items-center gap-1.5"
                    title="Resetuj hasło"
                  >
                    <Key className="w-3.5 h-3.5" />
                    Resetuj hasło
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
