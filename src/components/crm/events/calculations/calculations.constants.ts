import { Package, Users, Truck, MoreHorizontal } from 'lucide-react';
import { Category } from './calculations.types';

export const CATEGORY_META: Record<
  Category,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  equipment: { label: 'Sprzęt', icon: Package },
  staff: { label: 'Ludzie', icon: Users },
  transport: { label: 'Transport', icon: Truck },
  other: { label: 'Pozostałe', icon: MoreHorizontal },
};