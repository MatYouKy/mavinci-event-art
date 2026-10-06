import type { PersonnelQuestionnaire } from './questionnaire';
export type PersonnelPayrollProfile = {
 questionnaire?: PersonnelQuestionnaire;
 birth_date: string; education: string; education_from: string; education_to: string;
 own_employer: string; other_insurance: string; tax_residency: string; youth_opt_out: string;
 oral_confirmed: boolean; cash_requested: boolean;
};
export const emptyPayrollProfile = (): PersonnelPayrollProfile => ({birth_date:'',education:'unknown',education_from:'',education_to:'',own_employer:'unknown',other_insurance:'',tax_residency:'unknown',youth_opt_out:'unknown',oral_confirmed:false,cash_requested:false});
export const normalizePayrollProfile = (value: Partial<PersonnelPayrollProfile> | null | undefined): PersonnelPayrollProfile => ({...emptyPayrollProfile(),...value});
export const statutoryRates: Record<string,{hourly:number;monthly:number}> = {'2025':{hourly:30.50,monthly:4666},'2026':{hourly:31.40,monthly:4806},'2027':{hourly:32.30,monthly:4950}};
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const contractPrefix = (kind:string) => kind==='employment'?'UOP':kind==='mandate'?'UZ':kind==='specific_work'?'UOD':'';
