export interface LoginPayload {
  user_email: string;
  user_password: string;
}

export interface RegisterPayload {
  user_email: string;
  user_password: string;
  user_name: string;
}

export interface ResetPasswordPayload {
  token: string;
  user_password: string;
}

export interface AuthResponse {
  token: string;
}

export interface BasicResponse {
  message?: string;
  snackbar?: ISnackbar;
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

export type LoginResponse = APIResponse<'user', AuthResponse>;
