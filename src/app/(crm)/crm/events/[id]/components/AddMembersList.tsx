import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { EditIcon, Trash2, User, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';
import { Employee } from '@/lib/permissions';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { EmployeeAssignment } from '@/components/crm/Calendar';

interface TeamMembersListProps {
  employees: Employee[] | any[];
  onRemove: (id: string) => void;
  canManageTeam?: boolean;
  currentUserId?: string | null;
  eventCreatorId?: string;
}

export function TeamMembersList({
  employees,
  onRemove,
  canManageTeam = false,
  currentUserId = null,
  eventCreatorId,
}: TeamMembersListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editResponsibilities, setEditResponsibilities] = useState('');

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

  const startEdit = (item: any) => {
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
                  {!isEditing && canManageTeam && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <ResponsiveActionBar
                        disabledBackground
                        actions={[
                          {
                            label: '',
                            onClick: () => startEdit(item),
                            icon: <EditIcon className="h-4 w-4" />,
                            variant: 'primary',
                            show: true,
                          },
                          {
                            label: '',
                            onClick: () => openPermissionsModal(item),
                            icon: <User className="h-4 w-4" />,
                            variant: 'default',
                            show: true,
                          },
                          {
                            label: ``,
                            onClick: () => onRemove(item.id),
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                            show: true,
                          },
                        ]}
                      />
                    </div>
                  )}
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
            </div>
          );
        })}
      </div>

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
