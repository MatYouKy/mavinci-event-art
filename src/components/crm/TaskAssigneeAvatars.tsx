'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import Popover from '@/components/UI/Tooltip';

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
}

interface Assignee {
  employee_id: string;
  employees: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: ImageMetadata | null;
  };
}

interface Props {
  assignees: Assignee[];
  maxVisible?: number;
}

export default function TaskAssigneeAvatars({ assignees, maxVisible = 5 }: Props) {
  const router = useRouter();

  if (!assignees || assignees.length === 0) return null;

  const visibleAssignees = assignees.slice(0, maxVisible);
  const remainingCount = assignees.length - maxVisible;

  const handleProfileClick = (employeeId: string) => {
    router.push(`/crm/employees/${employeeId}`);
  };

  const renderAvatar = (assignee: Assignee, index: number) => {
    const { employees } = assignee;
    const position = employees.avatar_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };
    const objectFit = employees.avatar_metadata?.desktop?.objectFit || 'cover';
    const fullName = `${employees.name} ${employees.surname}`;
    const initials = `${employees.name[0]}${employees.surname[0]}`.toUpperCase();

    const avatar = (
      <div
        className="relative cursor-pointer overflow-hidden rounded-full border-2 border-[#0f1119] bg-[#1c1f33]"
        style={{
          width: '28px',
          height: '28px',
        }}
      >
        {employees.avatar_url ? (
          <img
            src={employees.avatar_url}
            alt={fullName}
            className="h-full w-full"
            style={{
              objectFit: objectFit as any,
              transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
            }}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-[#1c1f33] text-[#e5e4e2]/60"
            style={{ fontSize: '10px' }}
          >
            {initials}
          </div>
        )}
      </div>
    );

    const popoverContent = (
      <div className="min-w-[200px] p-3">
        <div className="flex items-start gap-3">
          <button
            onClick={() => handleProfileClick(assignee.employee_id)}
            className="relative flex-shrink-0 overflow-hidden rounded-full border-2 border-[#d3bb73]/20 bg-[#0f1119] transition-colors hover:border-[#d3bb73]/40"
            style={{ width: '48px', height: '48px' }}
            title="Zobacz profil"
          >
            {employees.avatar_url ? (
              <img
                src={employees.avatar_url}
                alt={fullName}
                className="h-full w-full"
                style={{
                  objectFit: objectFit as any,
                  transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#1c1f33] text-lg text-[#e5e4e2]/60">
                {initials}
              </div>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <button
              onClick={() => handleProfileClick(assignee.employee_id)}
              className="block w-full truncate text-left text-sm font-medium text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
            >
              {fullName}
            </button>

            <div className="mt-2 flex gap-1">
              <button
                onClick={() => handleProfileClick(assignee.employee_id)}
                className="flex-1 rounded bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              >
                Profil
              </button>
              <button
                onClick={() => router.push(`/crm/messages?to=${assignee.employee_id}`)}
                className="flex items-center justify-center rounded bg-[#d3bb73]/10 px-2 py-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                title="Czat prywatny"
              >
                <Mail className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return (
      <div
        key={assignee.employee_id}
        style={{
          marginLeft: index > 0 ? '-8px' : '0',
          zIndex: visibleAssignees.length - index,
        }}
      >
        <Popover trigger={avatar} placement="top" offset={8}>
          {popoverContent}
        </Popover>
      </div>
    );
  };

  return (
    <div className="flex items-center">
      {visibleAssignees.map((assignee, index) => renderAvatar(assignee, index))}

      {remainingCount > 0 && (
        <div
          className="relative flex items-center justify-center rounded-full border-2 border-[#0f1119] bg-[#1c1f33] text-[10px] text-[#e5e4e2]/60"
          style={{
            width: '28px',
            height: '28px',
            marginLeft: '-8px',
            zIndex: 0,
          }}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}
