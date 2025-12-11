import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { EditIcon, Trash2, User, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';
import { Employee } from '@/lib/permissions';


interface TeamMembersListProps {
  employees: Employee[];
  onRemove: (id: string) => void;
}

export function TeamMembersList({
  employees,
  onRemove,
}: {
  employees: Employee[];
  onRemove: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editResponsibilities, setEditResponsibilities] = useState('');
  const [removeModal, setRemoveModal] = useState<{
    isOpen: boolean;
    id: string;
    name: string;
  } | null>(null);
  const [permissionsModal, setPermissionsModal] = useState<{
    isOpen: boolean;
    assignment: any;
  } | null>(null);
  const [permissionsForm, setPermissionsForm] = useState({
    can_edit_event: false,
    can_edit_agenda: false,
    can_edit_tasks: false,
    can_edit_files: false,
    can_edit_equipment: false,
    can_invite_members: false,
    can_view_budget: false,
  });

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const openPermissionsModal = (assignment: any) => {
    setPermissionsForm({
      can_edit_event: assignment.can_edit_event || false,
      can_edit_agenda: assignment.can_edit_agenda || false,
      can_edit_tasks: assignment.can_edit_tasks || false,
      can_edit_files: assignment.can_edit_files || false,
      can_edit_equipment: assignment.can_edit_equipment || false,
      can_invite_members: assignment.can_invite_members || false,
      can_view_budget: assignment.can_view_budget || false,
    });
    setPermissionsModal({ isOpen: true, assignment });
  };

  const savePermissions = async () => {
    if (!permissionsModal) return;

    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          ...permissionsForm,
          permissions_updated_at: new Date().toISOString(),
        })
        .eq('id', permissionsModal.assignment.id);

      if (error) throw error;

      setPermissionsModal(null);
      window.location.reload();
    } catch (error) {
      console.error('Error updating permissions:', error);
      alert('Błąd podczas aktualizacji uprawnień');
    }
  };

  const startEdit = (item: Employee) => {
    setEditingId(item.id);
    setEditRole(item.role || '');
    setEditResponsibilities(item.responsibilities || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditRole('');
    setEditResponsibilities('');
  };

  const saveEdit = async (id: string) => {
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          role: editRole,
          responsibilities: editResponsibilities,
        })
        .eq('id', id);

      if (error) throw error;

      setEditingId(null);
      window.location.reload();
    } catch (error) {
      console.error('Error updating assignment:', error);
      alert('Błąd podczas aktualizacji');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return (
          <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">
            Zaakceptowano
          </span>
        );
      case 'rejected':
        return (
          <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-400">
            Odrzucono
          </span>
        );
      default:
        return (
          <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
            Oczekuje
          </span>
        );
    }
  };

  return (
    <>
      <div className="space-y-3">
        {employees.map((item) => {
          const isEditing = editingId === item.id;
          const isExpanded = expandedId === item.id;

          return (
            <div
              key={item.id}
              className={`overflow-hidden rounded-lg border bg-[#0f1119] ${
                item.status === 'rejected' ? 'border-red-500/30' : 'border-[#d3bb73]/10'
              }`}
            >
              <div
                onClick={() => !isEditing && toggleExpand(item.id)}
                className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-[#d3bb73]/5"
              >
                <EmployeeAvatar
                  avatarUrl={item.employee.avatar_url}
                  avatarMetadata={item.employee.avatar_metadata}
                  employeeName={`${item.employee.name} ${item.employee.surname}`}
                  size={48}
                  className="flex-shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-[#e5e4e2]">
                    {item.employee.nickname || `${item.employee.name} ${item.employee.surname}`}
                  </h3>
                  {item.role && !isEditing && <p className="text-sm text-[#d3bb73]">{item.role}</p>}
                  <div className="mt-1 flex items-center gap-2">{getStatusBadge(item.status)}</div>
                </div>

                <div className="flex items-center gap-2">
                  {!isEditing && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(item);
                        }}
                        className="rounded p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      >
                        <EditIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRemoveModal({
                            isOpen: true,
                            id: item.id,
                            name:
                              item.employee.nickname ||
                              `${item.employee.name} ${item.employee.surname}`,
                          });
                        }}
                        className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {!isEditing &&
                    (isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-[#e5e4e2]/60" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-[#e5e4e2]/60" />
                    ))}
                </div>
              </div>

              {isEditing && (
                <div className="space-y-3 border-t border-[#d3bb73]/10 p-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rola</label>
                    <input
                      type="text"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      placeholder="np. Lead Audio, Technician..."
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Zakres odpowiedzialności
                    </label>
                    <textarea
                      value={editResponsibilities}
                      onChange={(e) => setEditResponsibilities(e.target.value)}
                      className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      placeholder="Opisz zakres obowiązków..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(item.id)}
                      className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      Zapisz
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && !isEditing && (
                <div className="space-y-3 border-t border-[#d3bb73]/10 p-4">
                  {item.responsibilities && (
                    <div className="border-b border-[#d3bb73]/10 pb-3">
                      <div className="mb-1 text-xs text-[#e5e4e2]/60">
                        Zakres odpowiedzialności:
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/80">
                        {item.responsibilities}
                      </p>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      onClick={() => openPermissionsModal(item)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                    >
                      <User className="h-4 w-4" />
                      Zarządzaj uprawnieniami
                    </button>
                  </div>

                  {(item.can_edit_event ||
                    item.can_edit_agenda ||
                    item.can_edit_tasks ||
                    item.can_edit_files ||
                    item.can_edit_event ||
                    item.can_edit_equipment ||
                    item.can_invite_members ||
                    item.can_view_budget) && (
                    <div className="border-t border-[#d3bb73]/10 pt-2">
                      <div className="mb-2 text-xs text-[#e5e4e2]/60">Nadane uprawnienia:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.can_edit_event && (
                          <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                            Edycja wydarzenia
                          </span>
                        )}
                        {item.can_edit_agenda && (
                          <span className="rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-xs text-purple-400">
                            Edycja agendy
                          </span>
                        )}
                        {item.can_edit_tasks && (
                          <span className="rounded border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs text-green-400">
                            Zarządzanie zadaniami
                          </span>
                        )}
                        {item.can_edit_files && (
                          <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-400">
                            Zarządzanie plikami
                          </span>
                        )}
                        {item.can_edit_equipment && (
                          <span className="rounded border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-xs text-orange-400">
                            Zarządzanie sprzętem
                          </span>
                        )}
                        {item.can_invite_members && (
                          <span className="rounded border border-pink-500/20 bg-pink-500/10 px-2 py-1 text-xs text-pink-400">
                            Zapraszanie członków
                          </span>
                        )}
                        {item.can_view_budget && (
                          <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-400">
                            Widok budżetu
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {removeModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-6 flex items-start gap-4">
              <div className="rounded-lg bg-red-500/10 p-3">
                <AlertCircle className="h-6 w-6 text-red-400" />
              </div>
              <div>
                <h2 className="mb-2 text-xl font-light text-[#e5e4e2]">Usuń z zespołu</h2>
                <p className="text-[#e5e4e2]/60">
                  Czy na pewno chcesz usunąć{' '}
                  <span className="text-[#d3bb73]">{removeModal.name}</span> z zespołu wydarzenia?
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  onRemove(removeModal.id);
                  setRemoveModal(null);
                }}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600"
              >
                Usuń
              </button>
              <button
                onClick={() => setRemoveModal(null)}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {permissionsModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-6">
              <h2 className="mb-2 text-xl font-light text-[#e5e4e2]">Zarządzaj uprawnieniami</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {permissionsModal.assignment.employee?.nickname ||
                  `${permissionsModal.assignment.employee?.name} ${permissionsModal.assignment.employee?.surname}`}
              </p>
            </div>

            <div className="mb-6 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_event}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_event: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja wydarzenia</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować podstawowe informacje o wydarzeniu
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_agenda}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_agenda: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja agendy</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować harmonogram i agendę
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_tasks}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_tasks: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie zadaniami</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może tworzyć, edytować i usuwać zadania
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_files}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_files: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie plikami</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać pliki</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_equipment}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_equipment: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie sprzętem</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać sprzęt</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_invite_members}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_invite_members: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zapraszanie członków</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może zapraszać innych pracowników do zespołu
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_view_budget}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_view_budget: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Widok budżetu</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może przeglądać informacje finansowe
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={savePermissions}
                className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Zapisz
              </button>
              <button
                onClick={() => setPermissionsModal(null)}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}