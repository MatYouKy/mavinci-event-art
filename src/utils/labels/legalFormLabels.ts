export const legalFormLabels = {
  jdg: 'Jednoosobowa działalność gospodarcza (JDG)',
  sp_zoo: 'Spółka z ograniczoną odpowiedzialnością (sp. z o.o.)',
  sp_jawna: 'Spółka jawna',
  sp_partnerska: 'Spółka partnerska',
  sp_cywilna: 'Spółka cywilna',
  sp_komandytowa: 'Spółka komandytowa',
  sp_komandytowo_akcyjna: 'Spółka komandytowo-akcyjna',
  sp_akcyjna: 'Spółka akcyjna (S.A.)',
  prosta_sp_akcyjna: 'Prosta spółka akcyjna (P.S.A.)',
  spoldzielnia: 'Spółdzielnia',
  fundacja: 'Fundacja',
  stowarzyszenie: 'Stowarzyszenie',
  public_institution: 'Instytucja publiczna / jednostka sektora publicznego',
  local_government: 'Jednostka samorządu terytorialnego',
  state_legal_person: 'Państwowa osoba prawna',
  other_legal_entity: 'Inna osoba prawna lub jednostka organizacyjna',
  other: 'Inna',
} as const;

export type LegalForm = keyof typeof legalFormLabels;
