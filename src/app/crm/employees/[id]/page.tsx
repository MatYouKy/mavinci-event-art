'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, User, Mail, Phone, MapPin, Shield, Calendar, FileText, CheckSquare, Clock, CreditCard as Edit, Save, X, Plus, Trash2, Download, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmployeeEmailAccountsTab from '@/components/crm/EmployeeEmailAccountsTab';
import EmployeePermissionsTab from '@/components/crm/EmployeePermissionsTab';
import { Formik, Form } from 'formik';
import { ImageEditorField } from '@/components/ImageEditorField';
import { AvatarEditorModal } from '@/components/AvatarEditorModal';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { uploadImage } from '@/lib/storage';
import { IUploadImage, IImage } from '@/types/image';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import PrivateTasksBoard from '@/components/crm/PrivateTasksBoard';

interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  desktop?: {
    src?: string;
    position?: ImagePosition;
    objectFit?: string;
  };
  mobile?: {
    src?: string;
    position?: ImagePosition;
    objectFit?: string;
  };
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  email: string;
  phone_number: string | null;
  phone_private: string | null;
  avatar_url: string | null;
  avatar_metadata: ImageMetadata | null;
  background_image_url: string | null;
  background_metadata: ImageMetadata | null;
  role: string;
  access_level: string;
  access_level_id: string | null;
  occupation: string | null;
  region: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  nip: string | null;
  company_name: string | null;
  skills: string[] | null;
  qualifications: string[] | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  show_on_website: boolean;
  website_bio: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  order_index: number;
}

interface Document {
  id: string;
  name: string;
  document_type: string;
  file_url: string;
  file_size: number | null;
  description: string | null;
  expiry_date: string | null;
  is_active: boolean;
  uploaded_at: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  task_list_id: string | null;
}

interface EventAssignment {
  id: string;
  role_in_event: string;
  hours_worked: number | null;
  hourly_rate: number | null;
  assigned_at: string;
  event: {
    id: string;
    name: string;
    event_date: string;
    status: string;
  };
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<EventAssignment[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<Partial<Employee>>({});
  const [showAddDocumentModal, setShowAddDocumentModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [accessLevels, setAccessLevels] = useState<Array<{id: string; name: string; description: string}>>([]);

  const { employee: currentEmployee, isAdmin, canManagePermissions, canManageModule, loading: currentUserLoading } = useCurrentEmployee();

  useEffect(() => {
    if (employeeId && currentEmployee) {
      fetchEmployeeDetails();
      fetchDocuments();
      fetchTasks();
      fetchEvents();
      fetchEmailAccounts();
      fetchAccessLevels();
    }
  }, [employeeId, currentEmployee]);

  const canEdit = canManageModule('employees');

  const fetchEmployeeDetails = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (error) throw error;

      setEmployee(data);
      setEditedData(data);
    } catch (err) {
      console.error('Error fetching employee:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_documents')
        .select('*')
        .eq('employee_id', employeeId)
        .order('uploaded_at', { ascending: false });

      if (!error && data) {
        setDocuments(data);
      }
    } catch (err) {
      // Table employee_documents doesn't exist yet - silently ignore
    }
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('task_assignees')
        .select('*, tasks(*)')
        .eq('employee_id', employeeId);

      if (!error && data) {
        setTasks(data.map((item: any) => item.tasks).filter(Boolean));
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  };

  const fetchAccessLevels = async () => {
    try {
      const { data, error } = await supabase
        .from('access_levels')
        .select('id, name, description')
        .order('order_index');

      if (!error && data) {
        setAccessLevels(data);
      }
    } catch (err) {
      console.error('Error fetching access levels:', err);
    }
  };

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_event_assignments')
        .select('*, events(id, name, event_date, status)')
        .eq('employee_id', employeeId)
        .order('assigned_at', { ascending: false });

      if (!error && data) {
        setEvents(data as any);
      }
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  };

  const fetchEmailAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setEmailAccounts(data);
      }
    } catch (err) {
      console.error('Error fetching email accounts:', err);
    }
  };

  const handleSave = async () => {
    try {
      const { error } = await supabase
        .from('employees')
        .update(editedData)
        .eq('id', employeeId);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      setEmployee({ ...employee, ...editedData } as Employee);
      setIsEditing(false);
    } catch (err) {
      console.error('Error updating employee:', err);
      alert('Błąd podczas zapisywania zmian');
    }
  };

  const handleSaveImage = async (
    imageType: 'avatar' | 'background',
    payload: { file?: File; image: IUploadImage }
  ) => {
    try {
      let imageUrl = imageType === 'avatar' ? employee?.avatar_url : employee?.background_image_url;
      let imageMetadata = payload.image.image_metadata;

      if (payload.file) {
        const folder = imageType === 'avatar' ? 'employee-avatars' : 'employee-backgrounds';
        imageUrl = await uploadImage(payload.file, folder);

        imageMetadata = {
          desktop: {
            src: imageUrl,
            position: payload.image.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
            objectFit: payload.image.image_metadata?.desktop?.objectFit || (imageType === 'avatar' ? 'contain' : 'cover'),
          },
          mobile: {
            src: imageUrl,
            position: payload.image.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
            objectFit: payload.image.image_metadata?.mobile?.objectFit || (imageType === 'avatar' ? 'contain' : 'cover'),
          },
        };
      }

      const updateData: any = {};
      if (imageType === 'avatar') {
        updateData.avatar_url = imageUrl;
        updateData.avatar_metadata = imageMetadata;
      } else {
        updateData.background_image_url = imageUrl;
        updateData.background_metadata = imageMetadata;
      }

      const { error } = await supabase
        .from('employees')
        .update(updateData)
        .eq('id', employeeId);

      if (error) throw error;

      await fetchEmployeeDetails();
    } catch (err) {
      console.error('Error saving image:', err);
      throw err;
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten dokument?')) return;

    try {
      const { error } = await supabase
        .from('employee_documents')
        .delete()
        .eq('id', docId);

      if (error) throw error;

      fetchDocuments();
    } catch (err) {
      console.error('Error deleting document:', err);
      alert('Błąd podczas usuwania dokumentu');
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      admin: 'Administrator',
      manager: 'Menedżer',
      event_manager: 'Menedżer eventów',
      sales: 'Sprzedaż',
      logistics: 'Logistyka',
      technician: 'Technik',
      support: 'Wsparcie',
      freelancer: 'Freelancer',
      dj: 'DJ',
      mc: 'Konferansjer',
      assistant: 'Asystent',
      unassigned: 'Nieprzypisany',
    };
    return labels[role] || role;
  };

  const getAccessLevelLabel = (level: string) => {
    const labels: Record<string, string> = {
      admin: 'Pełny dostęp',
      manager: 'Menedżer',
      lead: 'Kierownik',
      operator: 'Operator',
      external: 'Zewnętrzny',
      guest: 'Gość',
      unassigned: 'Nieprzypisany',
      instructor: 'Instruktor',
    };
    return labels[level] || level;
  };

  const getTaskStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      todo: 'Do zrobienia',
      in_progress: 'W trakcie',
      review: 'Do przeglądu',
      done: 'Ukończone',
      cancelled: 'Anulowane',
    };
    return labels[status] || status;
  };

  const getTaskStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      todo: 'bg-gray-500/20 text-gray-400',
      in_progress: 'bg-blue-500/20 text-blue-400',
      review: 'bg-yellow-500/20 text-yellow-400',
      done: 'bg-green-500/20 text-green-400',
      cancelled: 'bg-red-500/20 text-red-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'bg-green-500/20 text-green-400',
      medium: 'bg-yellow-500/20 text-yellow-400',
      high: 'bg-orange-500/20 text-orange-400',
      urgent: 'bg-red-500/20 text-red-400',
    };
    return colors[priority] || 'bg-gray-500/20 text-gray-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Nie znaleziono pracownika</div>
      </div>
    );
  }

  const avatarImageData: IUploadImage = {
    alt: employee.name,
    image_metadata: {
      desktop: {
        src: employee.avatar_url,
        position: employee.avatar_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
        objectFit: employee.avatar_metadata?.desktop?.objectFit || 'cover',
      },
      mobile: {
        src: employee.avatar_url,
        position: employee.avatar_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
        objectFit: employee.avatar_metadata?.mobile?.objectFit || 'cover',
      },
    },
  };

  const backgroundImageData: IUploadImage = {
    alt: `${employee.name} tło`,
    image_metadata: employee.background_metadata || {
      desktop: {
        src: employee.background_image_url,
        position: { posX: 0, posY: 0, scale: 1 },
        objectFit: 'cover',
      },
      mobile: {
        src: employee.background_image_url,
        position: { posX: 0, posY: 0, scale: 1 },
        objectFit: 'cover',
      },
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/crm/employees')}
          className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-light text-[#e5e4e2]">
            {employee.name} {employee.surname}
          </h2>
          <p className="text-[#e5e4e2]/60 text-sm">
            {employee.occupation || getRoleLabel(employee.role)}
          </p>
        </div>
        {canEdit && !isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
          >
            <Edit className="w-4 h-4" />
            Edytuj
          </button>
        ) : isEditing ? (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
            >
              <Save className="w-4 h-4" />
              Zapisz
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setEditedData(employee);
              }}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
            >
              <X className="w-4 h-4" />
              Anuluj
            </button>
          </div>
        ) : null}
      </div>

      <Formik
        initialValues={{
          avatar: avatarImageData,
          background: backgroundImageData,
        }}
        onSubmit={() => {}}
        enableReinitialize
      >
        {() => (
          <Form>
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
              <div className="relative h-48 rounded-t-xl overflow-hidden" style={{ zIndex: isEditing ? 100 : 1 }}>
                <ImageEditorField
                  fieldName="background"
                  image={backgroundImageData}
                  isAdmin={isEditing && canEdit}
                  withMenu={isEditing && canEdit}
                  mode="horizontal"
                  menuPosition="left-top"
                  multiplier={3}
                  onSave={(payload) => handleSaveImage('background', payload)}
                />
              </div>
              <div className="relative" style={{ zIndex: isEditing ? 50 : 10 }}>
                <div className="absolute -top-16 left-6" style={{ zIndex: isEditing ? 50 : 10 }}>
                  <EmployeeAvatar
                    avatarUrl={employee.avatar_url}
                    avatarMetadata={employee.avatar_metadata}
                    employeeName={employee.name}
                    size={128}
                    onClick={() => {
                      if (isEditing && canEdit) {
                        setShowAvatarModal(true);
                      }
                    }}
                    showHoverEffect={isEditing && canEdit}
                  />
                </div>
              </div>

              <div className="pt-20 px-6 pb-6">
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className={`px-3 py-1 rounded-full text-xs ${
                      employee.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
                  </span>
                  <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs">
                    <Shield className="w-3 h-3 inline mr-1" />
                    {getAccessLevelLabel(employee.access_level)}
                  </span>
                  <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full text-xs">
                    {getRoleLabel(employee.role)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Mail className="w-4 h-4" />
                    <span>{employee.email}</span>
                  </div>
                  {employee.phone_number && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <Phone className="w-4 h-4" />
                      <span>{employee.phone_number}</span>
                    </div>
                  )}
                  {employee.region && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <MapPin className="w-4 h-4" />
                      <span>{employee.region}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Form>
        )}
      </Formik>

      <div className="flex gap-2 border-b border-[#d3bb73]/10 overflow-x-auto">
        {[
          { id: 'overview', label: 'Przegląd', icon: User },
          ...(currentEmployee?.id === employeeId || isAdmin || canEdit ? [{ id: 'emails', label: 'Konta Email', icon: Mail }] : []),
          ...(canManagePermissions ? [{ id: 'permissions', label: 'Uprawnienia', icon: Lock }] : []),
          ...(currentEmployee?.id === employeeId || isAdmin || canEdit ? [{ id: 'documents', label: 'Dokumenty', icon: FileText }] : []),
          ...(currentEmployee?.id === employeeId ? [{ id: 'tasks', label: 'Zadania', icon: CheckSquare }] : []),
          { id: 'events', label: 'Wydarzenia', icon: Calendar },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-[#d3bb73] text-[#d3bb73]'
                : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'emails' && (
        <EmployeeEmailAccountsTab
          employeeId={employeeId}
          employeeEmail={employee.email}
          isAdmin={isAdmin}
        />
      )}

      {activeTab === 'permissions' && canManagePermissions && (
        <EmployeePermissionsTab
          employeeId={employeeId}
          isAdmin={isAdmin}
          targetEmployeeRole={employee?.role}
          currentEmployeeId={currentEmployee?.id}
        />
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
              Informacje podstawowe
            </h3>
            <div className="space-y-3">
              {isEditing ? (
                <>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Imię</label>
                    <input
                      type="text"
                      value={editedData.name || ''}
                      onChange={(e) =>
                        setEditedData({ ...editedData, name: e.target.value })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Nazwisko</label>
                    <input
                      type="text"
                      value={editedData.surname || ''}
                      onChange={(e) =>
                        setEditedData({ ...editedData, surname: e.target.value })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Pseudonim</label>
                    <input
                      type="text"
                      value={editedData.nickname || ''}
                      onChange={(e) =>
                        setEditedData({ ...editedData, nickname: e.target.value })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Email</label>
                    <input
                      type="email"
                      value={editedData.email || ''}
                      onChange={(e) =>
                        setEditedData({ ...editedData, email: e.target.value })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Telefon</label>
                    <input
                      type="text"
                      value={editedData.phone_number || ''}
                      onChange={(e) =>
                        setEditedData({
                          ...editedData,
                          phone_number: e.target.value,
                        })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Stanowisko</label>
                    <input
                      type="text"
                      value={editedData.occupation || ''}
                      onChange={(e) =>
                        setEditedData({
                          ...editedData,
                          occupation: e.target.value,
                        })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  {isAdmin && (
                    <div>
                      <label className="text-xs text-[#e5e4e2]/60">Rola systemowa</label>
                      <select
                        value={editedData.access_level_id || ''}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            access_level_id: e.target.value || null,
                          })
                        }
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                      >
                        <option value="">Brak roli</option>
                        {accessLevels.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.name}
                          </option>
                        ))}
                      </select>
                      {editedData.access_level_id && accessLevels.find(l => l.id === editedData.access_level_id) && (
                        <p className="text-xs text-[#e5e4e2]/40 mt-1">
                          {accessLevels.find(l => l.id === editedData.access_level_id)?.description}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <InfoRow label="Imię" value={employee.name} />
                  <InfoRow label="Nazwisko" value={employee.surname} />
                  {employee.nickname && (
                    <InfoRow label="Pseudonim" value={employee.nickname} />
                  )}
                  <InfoRow label="Email" value={employee.email} />
                  {employee.phone_number && (
                    <InfoRow label="Telefon" value={employee.phone_number} />
                  )}
                  {employee.phone_private && (
                    <InfoRow
                      label="Telefon prywatny"
                      value={employee.phone_private}
                    />
                  )}
                  {employee.occupation && (
                    <InfoRow label="Stanowisko" value={employee.occupation} />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Adres</h3>
            <div className="space-y-3">
              {isEditing ? (
                <>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Ulica</label>
                    <input
                      type="text"
                      value={editedData.address_street || ''}
                      onChange={(e) =>
                        setEditedData({
                          ...editedData,
                          address_street: e.target.value,
                        })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[#e5e4e2]/60">
                        Kod pocztowy
                      </label>
                      <input
                        type="text"
                        value={editedData.address_postal_code || ''}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            address_postal_code: e.target.value,
                          })
                        }
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[#e5e4e2]/60">Miasto</label>
                      <input
                        type="text"
                        value={editedData.address_city || ''}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            address_city: e.target.value,
                          })
                        }
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Region</label>
                    <input
                      type="text"
                      value={editedData.region || ''}
                      onChange={(e) =>
                        setEditedData({ ...editedData, region: e.target.value })
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] mt-1"
                    />
                  </div>
                </>
              ) : (
                <>
                  {employee.address_street && (
                    <InfoRow label="Ulica" value={employee.address_street} />
                  )}
                  {employee.address_postal_code && employee.address_city && (
                    <InfoRow
                      label="Miasto"
                      value={`${employee.address_postal_code} ${employee.address_city}`}
                    />
                  )}
                  {employee.region && (
                    <InfoRow label="Region" value={employee.region} />
                  )}
                  {!employee.address_street &&
                    !employee.address_city &&
                    !employee.region && (
                      <p className="text-[#e5e4e2]/40 text-sm">Brak danych adresowych</p>
                    )}
                </>
              )}
            </div>
          </div>

          {employee.skills && employee.skills.length > 0 && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
                Umiejętności
              </h3>
              <div className="flex flex-wrap gap-2">
                {employee.skills.map((skill, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded-full text-sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Website Visibility Section */}
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
              Widoczność na stronie
            </h3>
            {isEditing ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="show_on_website"
                    checked={editedData.show_on_website || false}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        show_on_website: e.target.checked,
                      })
                    }
                    className="w-5 h-5 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                  />
                  <label htmlFor="show_on_website" className="text-[#e5e4e2]">
                    Wyświetl na stronie /zespół
                  </label>
                </div>

                <div>
                  <label className="text-xs text-[#e5e4e2]/60 block mb-1">
                    Kolejność wyświetlania (0 = pierwszy)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editedData.order_index ?? 999}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        order_index: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
                    placeholder="0"
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Niższa liczba = wyżej na liście. Admini mają automatycznie 0.
                  </p>
                </div>

                {editedData.show_on_website && (
                  <>
                    <div>
                      <label className="text-xs text-[#e5e4e2]/60 block mb-1">
                        Biografia (dla strony)
                      </label>
                      <textarea
                        value={editedData.website_bio || ''}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            website_bio: e.target.value,
                          })
                        }
                        rows={4}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
                        placeholder="Krótki opis do wyświetlenia na stronie..."
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="text-xs text-[#e5e4e2]/60 block mb-1">
                          LinkedIn URL
                        </label>
                        <input
                          type="url"
                          value={editedData.linkedin_url || ''}
                          onChange={(e) =>
                            setEditedData({
                              ...editedData,
                              linkedin_url: e.target.value,
                            })
                          }
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
                          placeholder="https://linkedin.com/in/..."
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#e5e4e2]/60 block mb-1">
                          Instagram URL
                        </label>
                        <input
                          type="url"
                          value={editedData.instagram_url || ''}
                          onChange={(e) =>
                            setEditedData({
                              ...editedData,
                              instagram_url: e.target.value,
                            })
                          }
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
                          placeholder="https://instagram.com/..."
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#e5e4e2]/60 block mb-1">
                          Facebook URL
                        </label>
                        <input
                          type="url"
                          value={editedData.facebook_url || ''}
                          onChange={(e) =>
                            setEditedData({
                              ...editedData,
                              facebook_url: e.target.value,
                            })
                          }
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2]"
                          placeholder="https://facebook.com/..."
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <InfoRow
                  label="Status"
                  value={employee.show_on_website ? '✓ Widoczny na stronie' : '✗ Ukryty'}
                />
                <InfoRow
                  label="Kolejność"
                  value={`${employee.order_index} ${employee.order_index === 0 ? '(pierwszy)' : ''}`}
                />
                {employee.show_on_website && (
                  <>
                    {employee.website_bio && (
                      <div>
                        <p className="text-xs text-[#e5e4e2]/60 mb-1">Biografia</p>
                        <p className="text-[#e5e4e2]">{employee.website_bio}</p>
                      </div>
                    )}
                    {employee.linkedin_url && (
                      <InfoRow label="LinkedIn" value={employee.linkedin_url} />
                    )}
                    {employee.instagram_url && (
                      <InfoRow label="Instagram" value={employee.instagram_url} />
                    )}
                    {employee.facebook_url && (
                      <InfoRow label="Facebook" value={employee.facebook_url} />
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {employee.notes && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Notatki</h3>
              {isEditing ? (
                <textarea
                  value={editedData.notes || ''}
                  onChange={(e) =>
                    setEditedData({ ...editedData, notes: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] min-h-[100px]"
                />
              ) : (
                <p className="text-[#e5e4e2]/70 text-sm whitespace-pre-wrap">
                  {employee.notes}
                </p>
              )}
            </div>
          )}

          {emailAccounts.length > 0 && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h3 className="text-lg font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Konta Email
              </h3>
              <div className="space-y-2">
                {emailAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-2 text-[#e5e4e2]/80"
                  >
                    <Mail className="w-4 h-4 text-[#d3bb73]" />
                    <span>{account.email_address}</span>
                    {account.is_primary && (
                      <span className="px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs">
                        Główne
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-light text-[#e5e4e2]">Dokumenty</h3>
            <button
              onClick={() => setShowAddDocumentModal(true)}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
            >
              <Plus className="w-4 h-4" />
              Dodaj dokument
            </button>
          </div>

          {documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak dokumentów</p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-[#d3bb73]" />
                      <div>
                        <h4 className="text-[#e5e4e2] font-medium">{doc.name}</h4>
                        {doc.description && (
                          <p className="text-[#e5e4e2]/60 text-sm">
                            {doc.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[#e5e4e2]/40 text-xs">
                            {new Date(doc.uploaded_at).toLocaleDateString('pl-PL')}
                          </span>
                          {doc.expiry_date && (
                            <>
                              <span className="text-[#e5e4e2]/40 text-xs">•</span>
                              <span
                                className={`text-xs ${
                                  new Date(doc.expiry_date) < new Date()
                                    ? 'text-red-400'
                                    : 'text-[#e5e4e2]/40'
                                }`}
                              >
                                Ważny do:{' '}
                                {new Date(doc.expiry_date).toLocaleDateString(
                                  'pl-PL'
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4 text-[#d3bb73]" />
                    </a>
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'tasks' && (
        <PrivateTasksBoard
          employeeId={employeeId as string}
          isOwnProfile={currentEmployee?.id === employeeId}
        />
      )}

      {activeTab === 'events' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-6">Wydarzenia</h3>

          {events.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych wydarzeń</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((assignment) => (
                <div
                  key={assignment.id}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 cursor-pointer hover:border-[#d3bb73]/30 transition-all"
                  onClick={() =>
                    router.push(`/crm/events/${assignment.event.id}`)
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-[#e5e4e2] font-medium mb-1">
                        {assignment.event.name}
                      </h4>
                      <p className="text-[#d3bb73] text-sm mb-2">
                        Rola: {assignment.role_in_event}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[#e5e4e2]/60">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(
                            assignment.event.event_date
                          ).toLocaleDateString('pl-PL')}
                        </span>
                        {assignment.hours_worked && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {assignment.hours_worked}h
                          </span>
                        )}
                        {assignment.hourly_rate && (
                          <span>
                            Stawka: {assignment.hourly_rate} zł/h
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddDocumentModal && (
        <AddDocumentModal
          isOpen={showAddDocumentModal}
          onClose={() => setShowAddDocumentModal(false)}
          employeeId={employeeId}
          onAdded={fetchDocuments}
        />
      )}

      <AvatarEditorModal
        open={showAvatarModal}
        onClose={() => setShowAvatarModal(false)}
        image={avatarImageData}
        onSave={(payload) => handleSaveImage('avatar', payload)}
        employeeName={`${employee?.name} ${employee?.surname}`}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-[#e5e4e2]/60">{label}</span>
      <p className="text-[#e5e4e2]">{value}</p>
    </div>
  );
}

function AddDocumentModal({
  isOpen,
  onClose,
  employeeId,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  onAdded: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    document_type: 'other',
    file_url: '',
    description: '',
    expiry_date: '',
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name || !formData.file_url) {
      alert('Wypełnij nazwę i URL pliku');
      return;
    }

    try {
      const { error } = await supabase.from('employee_documents').insert([
        {
          employee_id: employeeId,
          ...formData,
          expiry_date: formData.expiry_date || null,
        },
      ]);

      if (error) throw error;

      onAdded();
      onClose();
    } catch (err) {
      console.error('Error adding document:', err);
      alert('Błąd podczas dodawania dokumentu');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">
          Dodaj dokument
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa dokumentu *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              placeholder="np. Umowa zlecenie 2025"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Typ dokumentu
            </label>
            <select
              value={formData.document_type}
              onChange={(e) =>
                setFormData({ ...formData, document_type: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            >
              <option value="contract">Umowa</option>
              <option value="certificate">Certyfikat</option>
              <option value="id_document">Dokument tożsamości</option>
              <option value="other">Inny</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              URL pliku *
            </label>
            <input
              type="url"
              value={formData.file_url}
              onChange={(e) =>
                setFormData({ ...formData, file_url: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[80px]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Data ważności
            </label>
            <input
              type="date"
              value={formData.expiry_date}
              onChange={(e) =>
                setFormData({ ...formData, expiry_date: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
