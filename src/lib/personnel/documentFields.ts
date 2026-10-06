import type { ProfileAddress } from '@/components/crm/subcontractors/profileAddress';
export type TimeEvidenceMethod = 'crm' | 'task' | 'other';
export const timeEvidenceText = {
 crm: 'System CRM — raportowanie własnego czasu pracy.',
 task: 'Zadanie — raportowanie czasu pracy przy przypisanych zadaniach.',
} as const;
export const getTimeEvidenceMethod = (details: PersonnelDocumentDetails): TimeEvidenceMethod | '' =>
 details.time_evidence_method || (details.time_evidence?.trim() ? 'other' : '');
export type PersonnelDocumentDetails = {
 party_address_parts?: ProfileAddress;
 time_evidence_method?: TimeEvidenceMethod;
 work_place:string; job_title:string; work_time_fraction:string; additional_pay:string; overtime_threshold:string;
 term_basis:string; term_reason:string; acceptance_criteria:string; acceptance_procedure:string; materials:string; time_evidence:string;
};
export const emptyDocumentDetails = (): PersonnelDocumentDetails => ({work_place:'',job_title:'',work_time_fraction:'',additional_pay:'',overtime_threshold:'',term_basis:'standard',term_reason:'',acceptance_criteria:'',acceptance_procedure:'',materials:'',time_evidence:''});
export const normalizeDocumentDetails = (v?:Partial<PersonnelDocumentDetails>|null):PersonnelDocumentDetails => ({...emptyDocumentDetails(),...v});
export const documentTokens:Record<string,string> = {
 numer:'Numer umowy',data_zawarcia:'Data zawarcia',zleceniodawca:'Pełna nazwa działalności',adres_zleceniodawcy:'Adres działalności',nip_zleceniodawcy:'NIP działalności',reprezentacja:'Osoba reprezentująca działalność',osoba:'Osoba / wykonawca',adres_osoby:'Adres osoby / wykonawcy',identyfikator:'PESEL / NIP',zakres:'Zakres pracy lub rezultat dzieła',od:'Początek',do:'Koniec / termin oddania',wynagrodzenie:'Zapisane stawki z okresami',warunki_platnosci:'Termin i warunki płatności',rachunek:'Rachunek lub odbiór gotówki',ustalenia:'Dodatkowe ustalenia',miejsce:'Miejsce pracy lub przekazania',typ_okresu:'Rodzaj okresu umowy',okres_umowy:'Pełny zapis okresu',realizacja:'Realizacja / współpraca okresowa',forma_ustalen:'Pisemna / potwierdzenie ustnych ustaleń',sposob_wyplaty:'Przelew / gotówka',rozliczenie:'Cykl rozliczenia',ewidencja_godzin:'Potwierdzanie godzin',podatki_skladki:'Zasady PIT/ZUS z danych formularza',stanowisko:'Stanowisko / rodzaj pracy',wymiar_etatu:'Wymiar etatu',limit_ponadwymiarowy:'Próg dodatku przy niepełnym etacie',pozostale_skladniki:'Pozostałe składniki wynagrodzenia',podstawa_terminowa:'Podstawa umowy terminowej',kryteria_odbioru:'Cechy i kryteria dzieła',odbior:'Sposób przekazania i odbioru',materialy:'Materiały i narzędzia',
};
export const unknownDocumentTokens = (content:string) => Array.from(new Set(Array.from(content.matchAll(/\{\{([^}]+)\}\}/g),m=>m[1]).filter(key=>!Object.prototype.hasOwnProperty.call(documentTokens,key))));
