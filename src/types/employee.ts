export interface IEmployeeBasic {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  email: string;
  phone_number: string | null;
  avatar_url: string | null;
  avatar_metadata?: any;
  role: string;
  access_level: string;
  occupation: string | null;
  region: string | null;
  is_active: boolean;
  skills: string[] | null;
}

export interface IEmployeeCRM extends IEmployeeBasic {
  order_index: number;
}
