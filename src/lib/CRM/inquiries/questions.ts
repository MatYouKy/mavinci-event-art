export type InquiryQuestion = {
  id: string; question: string; answer: string;
  status: 'unanswered' | 'partial' | 'answered' | 'not_applicable' | 'waiting';
  source: string; updated_at: string | null;
};
export const questionStatusLabels = { unanswered: 'Do ustalenia', partial: 'Częściowa odpowiedź', answered: 'Uzupełnione', not_applicable: 'Nie dotyczy', waiting: 'Czekamy na klienta' };
export function mergeInquiryQuestions(existing: InquiryQuestion[], suggestions: string[]): InquiryQuestion[] {
  const normalize = (text: string) => text.trim().toLocaleLowerCase('pl-PL').replace(/[\s?!.]+/g, ' ');
  const result = existing.map(question => ({ ...question }));
  for (const question of suggestions) {
    if (!question.trim() || result.some(item => normalize(item.question) === normalize(question))) continue;
    result.push({ id: crypto.randomUUID(), question, answer: '', status: 'unanswered', source: 'Analiza AI', updated_at: null });
  }
  return result;
}
