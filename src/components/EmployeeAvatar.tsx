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

interface EmployeeAvatarProps {
  avatarUrl?: string | null;
  avatarMetadata?: ImageMetadata | null;
  employeeName: string;
  size?: number;
  className?: string;
  onClick?: () => void;
  showHoverEffect?: boolean;
}

export const EmployeeAvatar: React.FC<EmployeeAvatarProps> = ({
  avatarUrl,
  avatarMetadata,
  employeeName,
  size = 128,
  className = '',
  onClick,
  showHoverEffect = false,
}) => {
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
          {employeeName.charAt(0).toUpperCase()}
        </div>
      )}
      {showHoverEffect && (
        <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-sm font-medium">Edytuj</span>
        </div>
      )}
    </div>
  );
};
