export interface LoginPayload {
  user_email: string;
  user_password: string;
}

export interface RegisterPayload {
  user_email: string;
  user_password: string;
  user_name: string;
}

export interface IUserEmail {
  address: string;
  verified?: boolean;
}

export type UserRole =
  | 'admin'
  | 'manager'
  | 'event_manager'
  | 'sales'
  | 'logistics'
  | 'technician'
  | 'support'
  | 'freelancer'
  | 'dj'
  | 'mc'
  | 'assistant'
  | 'unassigned';

export type AccessTier =
  | 'admin'
  | 'manager'
  | 'lead'
  | 'operator'
  | 'external'
  | 'guest'
  | 'unassigned'
  | 'instructor';

export interface IUser {
  _id: string;
  user_name: string;
  user_surname?: string;
  user_nick?: string;
  user_email: IUserEmail;
  user_role: UserRole;
  user_access_level: AccessTier;
  user_phone_number?: string;
  user_is_active: boolean;
  user_last_login?: string;
  user_created_at: string;
  user_updated_at: string;
  user_avatar?: any;
  user_occupation?: string;
  user_region?: string;
  user_permissions?: string[];
}

export interface LoginResponse {
  message: string;
  statusCode: number;
  user: IUser;
  token: string;
}

export type SnackbarStatus = 'EDIT' | 'ERROR' | 'SUCCESS' | 'DELETE' | null;

export interface ISnackbar {
  status: SnackbarStatus;
  message: string;
  snackbarHideAfter?: number;
}

export type APIResponse<K extends string, T> = {
  snackbar: ISnackbar;
  [key: string]: any;
} & Record<K, T>;
