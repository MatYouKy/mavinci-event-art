import React, { FC, useState } from 'react';
import { iconMap } from '../ConferencesPage';
import { Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface ProcessSectionProps {
  isEditMode: boolean;
  process: any[];
  isEditingProcess: boolean;
  loadData: () => Promise<void>
  setIsEditingProcess: (isEditing: boolean) => void;
}

export const ProcessSection:FC<ProcessSectionProps> = ({ isEditMode, process, setIsEditingProcess, isEditingProcess, loadData }) => {
  const { showSnackbar } = useSnackbar();
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
    <section className="py-20 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-4xl font-light text-[#e5e4e2] text-center flex-1">
                Proces współpracy
              </h2>
              {isEditMode && !isEditingProcess && (
                <button
                  onClick={() => setIsEditingProcess(true)}
                  className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
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
                  className="px-4 py-2 bg-[#800020] text-[#e5e4e2] rounded-lg hover:bg-[#800020]/90 transition-colors text-sm"
                >
                  Zamknij edycję
                </button>
              )}
            </div>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Krok po kroku do profesjonalnej realizacji
            </p>

            <div className="space-y-6">
              {process.map((step) => {
                const Icon = getIcon(step.icon_name);
                const isEditing = editingProcessStep?.id === step.id;

                return (
                  <div key={step.id} className="flex gap-6 items-start">
                    <div className="w-16 h-16 bg-[#d3bb73] rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon className="w-8 h-8 text-[#1c1f33]" />
                    </div>
                    <div className="flex-1">
                      {isEditing ? (
                        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4 space-y-3">
                          <input
                            type="text"
                            value={editingProcessStep.step_title}
                            onChange={(e) => setEditingProcessStep({ ...editingProcessStep, step_title: e.target.value })}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                            placeholder="Tytuł kroku"
                          />
                          <textarea
                            value={editingProcessStep.step_description}
                            onChange={(e) => setEditingProcessStep({ ...editingProcessStep, step_description: e.target.value })}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73] resize-none"
                            rows={3}
                            placeholder="Opis kroku"
                          />
                          <input
                            type="text"
                            value={editingProcessStep.duration_info || ''}
                            onChange={(e) => setEditingProcessStep({ ...editingProcessStep, duration_info: e.target.value })}
                            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] text-sm outline-none focus:border-[#d3bb73]"
                            placeholder="Czas trwania (np. 1-2 dni)"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveProcessStep(editingProcessStep)}
                              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors text-sm"
                            >
                              Zapisz
                            </button>
                            <button
                              onClick={() => setEditingProcessStep(null)}
                              className="px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded hover:bg-[#800020]/30 transition-colors text-sm"
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-2xl font-medium text-[#e5e4e2]">
                              {step.step_title}
                            </h3>
                            {step.duration_info && (
                              <span className="text-xs text-[#d3bb73] px-3 py-1 bg-[#d3bb73]/10 rounded-full">
                                {step.duration_info}
                              </span>
                            )}
                            {isEditMode && isEditingProcess && (
                              <button
                                onClick={() => setEditingProcessStep(step)}
                                className="ml-auto px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded hover:bg-[#d3bb73]/30 transition-colors text-xs"
                              >
                                Edytuj
                              </button>
                            )}
                          </div>
                          <p className="text-[#e5e4e2]/70">
                            {step.step_description}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
  )
}
