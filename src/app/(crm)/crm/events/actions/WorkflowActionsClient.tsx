'use client';
import MyEventStepsSection from '@/components/crm/events/steps/MyEventStepsSection';

/**
 * „Moje kroki”: kroki realizacji przypisane do Twojej roli we wszystkich wydarzeniach.
 * Dawna lista „Wydarzenia, które prowadzisz — następne kroki” (get_my_event_workflow_actions) została zastąpiona
 * krokami realizacji — formalności i rozliczenie są krokami prowadzącego.
 */
export default function WorkflowActionsClient() {
  return (
    <main className="w-full space-y-8 p-4">
      <header>
        <h1 className="text-xl text-[#e5e4e2]">Moje kroki</h1>
        <p className="mt-1 text-sm text-[#e5e4e2]/60">
          Wszystko, co masz teraz do zrobienia w wydarzeniach: kroki realizacji Twojej roli — od formalności, przez
          przygotowanie i wyjazd, po rozliczenie.
        </p>
      </header>
      <MyEventStepsSection />
    </main>
  );
}
