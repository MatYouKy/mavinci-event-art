import React, { FC, useState } from 'react';
import { iconMap } from '../ConferencesPage';
import { Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useMobile } from '@/hooks/useMobile';

interface ProcessSectionProps {
  isEditMode: boolean;
  process: any[];
  isEditingProcess: boolean;
  loadData: () => Promise<void>;
  setIsEditingProcess: (isEditing: boolean) => void;
}

export const ProcessSection: FC<ProcessSectionProps> = ({
  isEditMode,
  process,
  setIsEditingProcess,
  isEditingProcess,
  loadData,
}) => {
  const { showSnackbar } = useSnackbar();
  const isMobile = useMobile();
  const [editingProcessStep, setEditingProcessStep] = useState<any>(null);

  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Settings;
    return Icon;
  };

  const handleSaveProcessStep = async (stepData: any) => {
    try {
      const { error } = await supabase
        .from('conferences_process')
        .update({
          step_title: stepData.step_title,
          step_description: stepData.step_description,
          duration_info: stepData.duration_info,
          icon_name: stepData.icon_name,
        })
        .eq('id', stepData.id);

      if (error) throw error;

      await loadData();
      setEditingProcessStep(null);
      showSnackbar('Krok procesu zaktualizowany!', 'success');
    } catch (error) {
      console.error('Error saving process step:', error);
      showSnackbar('Błąd podczas zapisywania', 'error');
    }
  };

  return (
    <section className="px-6 md:px-12 lg:px-16 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex-1 text-center text-4xl font-light text-[#e5e4e2]">
            Proces współpracy
          </h2>
          {isEditMode && !isEditingProcess && (
            <button
              onClick={() => setIsEditingProcess(true)}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Edytuj proces
            </button>
          )}
          {isEditMode && isEditingProcess && (
            <button
              onClick={() => {
                setIsEditingProcess(false);
                setEditingProcessStep(null);
              }}
              className="rounded-lg bg-[#800020] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#800020]/90"
            >
              Zamknij edycję
            </button>
          )}
        </div>
        <p className="mb-16 text-center text-[#e5e4e2]/60">
          Krok po kroku do profesjonalnej realizacji
        </p>

        <div className="space-y-6">
          {process.map((step) => {
            const Icon = getIcon(step.icon_name);
            const isEditing = editingProcessStep?.id === step.id;

            return (
              <div key={step.id} className="flex items-start gap-6">
                {/* Ikona po lewej w trybie edycji (w widoku nie-edytorskim jest wewnątrz itemów) */}
                {!isEditing && (
                  <div className="hidden md:flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]">
                    <Icon className="h-8 w-8 text-[#1c1f33]" />
                  </div>
                )}

                <div className="flex-1">
                  {isEditing ? (
                    <div className="space-y-3 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-2 md:p-4">
                      <input
                        type="text"
                        value={editingProcessStep.step_title}
                        onChange={(e) =>
                          setEditingProcessStep({
                            ...editingProcessStep,
                            step_title: e.target.value,
                          })
                        }
                        className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73] md:px-3"
                        placeholder="Tytuł kroku"
                      />
                      <textarea
                        value={editingProcessStep.step_description}
                        onChange={(e) =>
                          setEditingProcessStep({
                            ...editingProcessStep,
                            step_description: e.target.value,
                          })
                        }
                        className="w-full resize-none rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                        rows={3}
                        placeholder="Opis kroku"
                      />
                      <input
                        type="text"
                        value={editingProcessStep.duration_info || ''}
                        onChange={(e) =>
                          setEditingProcessStep({
                            ...editingProcessStep,
                            duration_info: e.target.value,
                          })
                        }
                        className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73] md:px-3"
                        placeholder="Czas trwania (np. 1-2 dni)"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveProcessStep(editingProcessStep)}
                          className="rounded bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                        >
                          Zapisz
                        </button>
                        <button
                          onClick={() => setEditingProcessStep(null)}
                          className="rounded bg-[#800020]/20 px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isMobile ? (
                        <AdvantageMobileItem
                          title={step.step_title}
                          description={step.step_description}
                          Icon={Icon}
                          duration_info={step.duration_info}
                          showEditButton={isEditMode && isEditingProcess}
                          onEditClick={() => setEditingProcessStep(step)}
                        />
                      ) : (
                        <ProcessDesktopItem
                          title={step.step_title}
                          description={step.step_description}
                          Icon={Icon}
                          durationInfo={step.duration_info}
                          showEditButton={isEditMode && isEditingProcess}
                          onEditClick={() => setEditingProcessStep(step)}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const ProcessDesktopItem: FC<{
  title: string;
  description: string;
  Icon: React.ElementType;
  durationInfo?: string;
  showEditButton?: boolean;
  onEditClick?: () => void;
}> = ({ title, description, Icon, durationInfo, showEditButton, onEditClick }) => {
  return (
    <div className="flex gap-4">
      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73] md:hidden">
        {/* Ikona mobilna w desktopowym layoucie (dla mniejszych szerokości) */}
        <Icon className="h-8 w-8 text-[#1c1f33]" />
      </div>
      <div className="flex-1">
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-xl font-medium text-[#e5e4e2] md:text-2xl">{title}</h3>
          {durationInfo && (
            <span className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73] md:text-sm">
              {durationInfo}
            </span>
          )}
          {showEditButton && (
            <button
              onClick={onEditClick}
              className="ml-auto rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30 md:px-3 md:text-sm"
            >
              Edytuj
            </button>
          )}
        </div>
        <p className="text-sm text-[#e5e4e2]/70 md:text-base">{description}</p>
      </div>
    </div>
  );
};

const AdvantageMobileItem: FC<{
  title: string;
  description: string;
  Icon: React.ElementType;
  duration_info?: string;
  showEditButton?: boolean;
  onEditClick?: () => void;
}> = ({ title, description, Icon, duration_info, showEditButton, onEditClick }) => {
  return (
    <div className="space-y-2 md:hidden mb-5">
      <div className="flex flex-col md:flex-row items-center gap-2">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]">
          <Icon className="h-4 w-4 text-[#1c1f33]" />
        </div>
        <h3 className="text-base font-medium text-[#e5e4e2]">{title}</h3>
        {showEditButton && (
          <button
            onClick={onEditClick}
            className="ml-auto rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
          >
            Edytuj
          </button>
        )}
      </div>
      <p className="text-xs text-[#e5e4e2]/70 text-justify">{description}</p>
      {duration_info && (
        <div className="flex items-center justify-center mt-2">
          <span className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">
            {duration_info}
          </span>
        </div>
      )}
    </div>
  );
};