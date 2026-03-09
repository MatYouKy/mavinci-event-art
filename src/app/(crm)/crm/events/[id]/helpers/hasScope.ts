import { IEmployee } from '../../../employees/type';

export const hasScope = (scope: string, employee: IEmployee): boolean => {
  if (!employee) return false;
  return employee.permissions?.includes(scope) || false;
};