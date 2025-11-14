import { useAppSelector } from '@/store/hooks';
import { AccessTier, IUser } from '@/types/auth.types';
import { useMemo } from 'react';

interface EmployeeData {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  email: string;
  role: string;
  access_level: string;
  avatar_url: string | null;
  avatar_metadata?: {
    desktop?: {
      position?: {
        posX: number;
        posY: number;
        scale: number;
      };
      objectFit?: string;
    };
  };
}

interface UseAuthResult {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isGuest: boolean;
  isUnassigned: boolean;
  hasAccessLevel: (level: AccessTier) => boolean;
  isCurrentUser: (id?: string) => boolean;
  userId?: string;
  user: IUser | null;
  token: string | null;
}

export const useAuth = (): UseAuthResult => {
  const { user, token, isAuthenticated } = useAppSelector((state) => state.auth);
  const accessLevel: AccessTier = user?.user_access_level || 'guest';
  const userId = user?._id;

  return useMemo(() => {
    const isAdmin = accessLevel === 'admin';
    const isManager = accessLevel === 'manager';
    const isGuest = accessLevel === 'guest';
    const isUnassigned = accessLevel === 'unassigned';

    const hasAccessLevel = (level: AccessTier) => accessLevel === level;
    const isCurrentUser = (id?: string) => Boolean(id && userId && id === userId);

    return {
      isAuthenticated,
      isAdmin,
      isManager,
      isGuest,
      isUnassigned,
      hasAccessLevel,
      isCurrentUser,
      userId,
      user,
      token,
    };
  }, [accessLevel, isAuthenticated, token, user, userId]);
};