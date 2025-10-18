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
        className="relative rounded-full border-2 border-[#0f1119] bg-[#1c1f33] overflow-hidden cursor-pointer"
        style={{
          width: '28px',
          height: '28px',
        }}
      >
        {employees.avatar_url ? (
          <img
            src={employees.avatar_url}
            alt={fullName}
            className="w-full h-full"
            style={{
              objectFit: objectFit as any,
              transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
            }}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-[#e5e4e2]/60 bg-[#1c1f33]"
            style={{ fontSize: '10px' }}
          >
            {initials}
          </div>
        )}
      </div>
    );

    const popoverContent = (
      <div className="p-3 min-w-[200px]">
        <div className="flex items-start gap-3">
          <div
            className="relative rounded-full border-2 border-[#d3bb73]/20 bg-[#0f1119] overflow-hidden flex-shrink-0"
            style={{ width: '48px', height: '48px' }}
          >
            {employees.avatar_url ? (
              <img
                src={employees.avatar_url}
                alt={fullName}
                className="w-full h-full"
                style={{
                  objectFit: objectFit as any,
                  transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#e5e4e2]/60 bg-[#1c1f33] text-lg">
                {initials}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <button
              onClick={() => handleProfileClick(assignee.employee_id)}
              className="text-sm font-medium text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors text-left block truncate w-full"
            >
              {fullName}
            </button>

            <div className="flex gap-1 mt-2">
              <button
                onClick={() => handleProfileClick(assignee.employee_id)}
                className="flex-1 px-2 py-1 bg-[#d3bb73]/10 hover:bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs transition-colors"
              >
                Profil
              </button>
              <button
                onClick={() => router.push(`/crm/messages?to=${assignee.employee_id}`)}
                className="flex items-center justify-center px-2 py-1 bg-[#d3bb73]/10 hover:bg-[#d3bb73]/20 text-[#d3bb73] rounded transition-colors"
                title="Wyślij wiadomość"
              >
                <Mail className="w-3 h-3" />
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
        <Popover
          trigger={avatar}
          placement="top"
          offset={8}
        >
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
          className="relative rounded-full border-2 border-[#0f1119] bg-[#1c1f33] flex items-center justify-center text-[10px] text-[#e5e4e2]/60"
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
