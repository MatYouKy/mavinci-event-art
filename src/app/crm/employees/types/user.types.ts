export type UserRole =
  | 'admin' // prezes, pełny dostęp
  | 'manager' // menedżer działu
  | 'event_manager'
  | 'sales'
  | 'logistics'
  | 'technician'
  | 'support'
  | 'freelancer'
  | 'support'
  | 'dj'
  | 'mc' // konferansjer (master of ceremony)
  | 'assistant'
  | 'unassigned';

export type AccessTier =
  | 'admin' // pełny dostęp, zarządzanie całością systemu
  | 'manager' // dostęp do przypisanego zakresu, może nadawać uprawnienia
  | 'lead' // kierownik zespołu/projektu, operacyjny nadzór, bez zarządzania ludźmi
  | 'operator' // wykonawca / realizacja, tworzenie danych (np. wydarzeń)
  | 'external' // osoba z zewnątrz, dostęp tylko do przypisanych elementów
  | 'guest' // osoba z zewnątrz, dostęp tylko do przypisanych elementów
  | 'unassigned' // osoba z zewnątrz, dostęp tylko do przypisanych elementów
  | 'instructor'; // instruktor, dostęp tylko do przypisanych elementów

interface IUserEmail {
  address: string; // Główny adres e-mail (widoczny wszędzie)
  verified?: boolean;
}

interface IUserVisibilityEntry {
  key: string;
  expires_at?: string | true; // np. ISO: "2025-05-10T23:59:59Z"
}

export interface IUserBase {
  _id?: string;
  user_name: string;
  user_nick?: string;
  user_surname?: string;
  user_address: IAddress;
  user_nip?: string;

  user_email: IUserEmail;
  user_email_access?: IMailAccess; // ukryte, tylko dla systemu
  user_visibility?: IUserVisibilityEntry[];

  user_role: UserRole;
  user_phone_number?: string;
  user_phone_private?: string;
  user_avatar?: IImage;
  user_occupation?: string;
  user_region?: string;

  user_access_level: AccessTier;

  user_permissions?: string[];
  user_is_active: boolean;
  user_last_login?: string;
  user_created_at: string;
  user_updated_at: string;

  user_tasks?: IUserTask[];
  user_skills?: string[];
  user_qualifications?: string[];
  user_calendar_events?: string[];
  user_token?: string | null;

  user_history?: IHistoryEntry[];
}

export interface IUserBaseWithPassword extends IUserBase {
  reset_token?: string;
  user_password: string; // tylko backend, tylko baza
  activation_token: string | null;
}

export type IUserWithPassword = IUserBaseWithPassword; // + przyszłe rozszerzenia

export interface IUserCreateInput {
  user_name: string;
  user_surname?: string;
  user_nick?: string;
  user_email: string;
  user_phone_number?: string;

  user_role: UserRole;
  user_password: string; // plain-text (do zahashowania w backendzie)
  user_region?: string;
  user_occupation?: string;
  user_is_active?: boolean;
}

export interface IUserLoginInput {
  user_email: string;
  user_password: string;
}

export interface AuthPayload {
  user_id: string;
  user_role: UserRole;
  exp: number;
}

export interface IUserForm
  extends WithAvatarFields<Omit<IUserBase, 'user_avatar' | '_id'>> {}

export interface IUserSignupForm
  extends Omit<IUserForm, 'user_email' | 'user_avatar'> {
  user_password: string;
  user_email: IUserEmail;
}

export type UserFormProps = IUserForm & IUserSignupForm;

export interface IUserSales extends IUserBase {}
export interface IUserManager extends IUserBase {}
export interface IUserTechnician extends IUserBase {}

export type IUser = IUserSales | IUserManager | IUserTechnician | IUserBase;
