'use client';

import React from 'react';

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
  employee?: never;
}

interface EmployeeAvatarPropsNew {
  employee: {
    avatar_url?: string | null;
    avatar_metadata?: ImageMetadata | null;
    name?: string;
    surname?: string;
    nickname?: string;
  };
  size?: number;
  className?: string;
  onClick?: () => void;
  showHoverEffect?: boolean;
  avatarUrl?: never;
  avatarMetadata?: never;
  employeeName?: never;
}

type EmployeeAvatarProps = EmployeeAvatarPropsLegacy | EmployeeAvatarPropsNew;

export const EmployeeAvatar: React.FC<EmployeeAvatarProps> = (props) => {
  const { size = 128, className = '', onClick, showHoverEffect = false } = props;

  const avatarUrl = 'employee' in props ? props.employee.avatar_url : props.avatarUrl;
  const avatarMetadata =
    'employee' in props ? props.employee.avatar_metadata : props.avatarMetadata;
  const employeeName =
    'employee' in props
      ? props.employee.nickname ||
        `${props.employee.name || ''} ${props.employee.surname || ''}`.trim() ||
        'User'
      : props.employeeName;

  const position = avatarMetadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };
  const objectFit = avatarMetadata?.desktop?.objectFit || 'cover';

  return (
    <div
      className={`relative overflow-hidden rounded-full border-4 border-[#1c1f33] bg-[#1c1f33] ${showHoverEffect ? 'cursor-pointer transition-all hover:ring-2 hover:ring-[#d3bb73]' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
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
      {showHoverEffect && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity hover:opacity-100">
          <span className="text-sm font-medium text-white">Edytuj</span>
        </div>
      )}
    </div>
  );
};
