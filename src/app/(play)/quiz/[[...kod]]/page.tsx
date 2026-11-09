import QuizPlayerClient from './QuizPlayerClient';

export const dynamic = 'force-dynamic';

// mavinci.pl/quiz (wpisz kod) i mavinci.pl/quiz/KOD (prosto z kodu QR).
export default function QuizPlayPage({ params }: { params: { kod?: string[] } }) {
  const code = (params.kod?.[0] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return <QuizPlayerClient initialCode={code} />;
}
