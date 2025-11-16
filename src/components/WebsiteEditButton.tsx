'use client';

import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { Edit } from 'lucide-react';
import Link from 'next/link';

interface WebsiteEditButtonProps {
  href: string;
  label?: string;
  className?: string;
}

export default function WebsiteEditButton({
  href,
  label = 'Edytuj sekcję',
  className = '',
}: WebsiteEditButtonProps) {
  const { canEdit, loading } = useWebsiteEdit();

  if (loading || !canEdit) {
    return null;
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] shadow-lg transition-colors hover:bg-[#d3bb73]/90 hover:shadow-xl ${className}`}
    >
      <Edit className="h-4 w-4" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}
