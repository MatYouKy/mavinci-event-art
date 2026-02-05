'use client';

import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import Image from 'next/image';
interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  desktop?: { src?: string; position?: ImagePosition; objectFit?: string };
  mobile?: { src?: string; position?: ImagePosition; objectFit?: string };
}

interface EmployeeAvatarPropsLegacy {
  employeeId?: string;
  avatarUrl?: string | null;
  avatarMetadata?: ImageMetadata | null;
  employeeName: string;
  size?: number;
  className?: string;
  onClick?: () => void;
  showHoverEffect?: boolean;
  showActivityStatus?: boolean;
  employee?: IEmployee;
}

interface EmployeeAvatarPropsNew {
  employee: IEmployee;
  size?: number;
  className?: string;
  onClick?: () => void;
  showHoverEffect?: boolean;
  showActivityStatus?: boolean;
  avatarUrl?: never;
  avatarMetadata?: never;
  employeeName?: never;
  employeeId?: never;
}

type EmployeeAvatarProps = EmployeeAvatarPropsLegacy | EmployeeAvatarPropsNew;

export const EmployeeAvatar: React.FC<EmployeeAvatarProps> = (props) => {
  const { isOnline, getLastActivityAt } = useAuth();

  const {
    size = 128,
    className = '',
    onClick,
    showHoverEffect = false,
    showActivityStatus = false,
  } = props;

  const hasEmployee = 'employee' in props && !!props.employee;
  const employeeObj = hasEmployee
    ? props.employee
    : ((props as EmployeeAvatarPropsLegacy).employee ?? null);

  const employeeId =
    employeeObj?.id ??
    (!hasEmployee ? ((props as EmployeeAvatarPropsLegacy).employeeId ?? null) : null);

  const avatarUrl =
    employeeObj?.avatar_url ??
    (!hasEmployee ? ((props as EmployeeAvatarPropsLegacy).avatarUrl ?? null) : null);

  const avatarMetadata =
    employeeObj?.avatar_metadata ??
    (!hasEmployee ? ((props as EmployeeAvatarPropsLegacy).avatarMetadata ?? null) : null);

  const employeeName = hasEmployee
    ? employeeObj?.nickname ||
      `${employeeObj?.name || ''} ${employeeObj?.surname || ''}`.trim() ||
      'User'
    : (props as EmployeeAvatarPropsLegacy).employeeName;

    const online = !!(showActivityStatus && employeeId && isOnline(employeeId));

    const presenceAt = employeeId ? getLastActivityAt(employeeId) : null;
    
    // Fallback do DB (jeśli presence jeszcze nie ma)
    const dbAt = employeeObj?.last_active_at ?? null;
    
    const effectiveAt = presenceAt ?? dbAt ?? null;
    
    const getStatus = () => {
      if (!online) return 'offline';
    
      const last = effectiveAt ? new Date(effectiveAt).getTime() : 0;
      const mins = last ? (Date.now() - last) / 60000 : 9999;
    
      if (mins <= 10) return 'green';
      if (mins <= 30) return 'yellow';
      return 'red';
    };
    
    const status = showActivityStatus ? getStatus() : 'offline';

  const position = avatarMetadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };
  const objectFit = avatarMetadata?.desktop?.objectFit || 'cover';

  // ✅ kropka skaluje się z avatarem (min 6px, max 14px)
  const dot = Math.max(6, Math.min(14, Math.round(size * 0.18)));

  return (
    // ✅ wrapper bez className (żeby nie robić prostokątnych obrysów)
    <div className="relative overflow-visible" style={{ width: size, height: size }}>
      {/* ✅ wszystko co “wyglądowe” zostaje na kółku */}
      <div
        className={`relative h-full w-full overflow-hidden rounded-full border-4 border-[#1c1f33] bg-[#1c1f33] ${showHoverEffect ? 'cursor-pointer transition-all hover:ring-2 hover:ring-[#d3bb73]' : ''} ${className}`}
        onClick={onClick}
      >
        {avatarUrl ? (
          <Image
            width={size}
            height={size}
            src={avatarUrl as string}
            alt={employeeName}
            className="h-full w-full"
            style={{
              objectFit: objectFit as any,
              transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
            }}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-[#1c1f33] text-[#e5e4e2]/40"
            style={{ fontSize: size / 3 }}
          >
            {employeeName ? employeeName.charAt(0).toUpperCase() : '?'}
          </div>
        )}
      </div>

      {showActivityStatus && status !== 'offline' && (
        <div className="absolute bottom-0 right-2">
          <div
            title={
              status === 'green'
                ? 'Online (aktywny)'
                : status === 'yellow'
                  ? 'Online (nieaktywny > 10 min)'
                  : 'Online (nieaktywny > 30 min)'
            }
            style={{ width: dot, height: dot }}
            className={`rounded-full ring-1 ring-offset-2 ring-offset-[#1c1f33] ${
              status === 'green'
                ? 'bg-green-500'
                : status === 'yellow'
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
          />
        </div>
      )}
    </div>
  );
};
