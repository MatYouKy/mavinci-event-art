'use client';

import React from 'react';
import { ActivityStatusIndicator } from './crm/ActivityStatusIndicator';

interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  desktop?: {
    src?: string;
    position?: ImagePosition;
    objectFit?: string;
  };
  mobile?: {
    src?: string;
    position?: ImagePosition;
    objectFit?: string;
  };
}

interface EmployeeAvatarPropsLegacy {
  avatarUrl?: string | null;
  avatarMetadata?: ImageMetadata | null;
  employeeName: string;
  size?: number;
  className?: string;
  onClick?: () => void;
  showHoverEffect?: boolean;
  showActivityStatus?: boolean;
  lastActiveAt?: string | null;
  employee?: never;
}

interface EmployeeAvatarPropsNew {
  employee: {
    avatar_url?: string | null;
    avatar_metadata?: ImageMetadata | null;
    name?: string;
    surname?: string;
    nickname?: string;
    last_active_at?: string | null;
  };
  size?: number;
  className?: string;
  onClick?: () => void;
  showHoverEffect?: boolean;
  showActivityStatus?: boolean;
  avatarUrl?: never;
  avatarMetadata?: never;
  employeeName?: never;
  lastActiveAt?: never;
}

type EmployeeAvatarProps = EmployeeAvatarPropsLegacy | EmployeeAvatarPropsNew;

export const EmployeeAvatar: React.FC<EmployeeAvatarProps> = (props) => {
  const {
    size = 128,
    className = '',
    onClick,
    showHoverEffect = false,
    showActivityStatus = false,
  } = props;

  const avatarUrl = 'employee' in props ? props.employee.avatar_url : props.avatarUrl;
  const avatarMetadata = 'employee' in props ? props.employee.avatar_metadata : props.avatarMetadata;
  const employeeName = 'employee' in props
    ? (props.employee.nickname || `${props.employee.name || ''} ${props.employee.surname || ''}`.trim() || 'User')
    : props.employeeName;
  const lastActiveAt = 'employee' in props ? props.employee.last_active_at : props.lastActiveAt;

  const position = avatarMetadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };
  const objectFit = avatarMetadata?.desktop?.objectFit || 'cover';

  return (
    <div
      className={`relative rounded-full border-4 border-[#1c1f33] bg-[#1c1f33] overflow-hidden ${showHoverEffect ? 'cursor-pointer hover:ring-2 hover:ring-[#d3bb73] transition-all' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={employeeName}
          className="w-full h-full"
          style={{
            objectFit: objectFit as any,
            transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[#e5e4e2]/40 bg-[#1c1f33]" style={{ fontSize: size / 3 }}>
          {employeeName ? employeeName.charAt(0).toUpperCase() : '?'}
        </div>
      )}
      {showHoverEffect && (
        <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-sm font-medium">Edytuj</span>
        </div>
      )}
      {showActivityStatus && (
        <div className="absolute bottom-0 right-0 translate-x-[10%] translate-y-[10%]">
          <ActivityStatusIndicator
            lastActiveAt={lastActiveAt}
            size={size > 64 ? 'md' : 'sm'}
            showTooltip={true}
          />
        </div>
      )}
    </div>
  );
};
