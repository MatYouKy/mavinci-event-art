'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Shield,
  Calendar,
  FileText,
  CheckSquare,
  Clock,
  CreditCard as Edit,
  Save,
  X,
  Plus,
  Trash2,
  Download,
  Lock,
  Award,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmployeeEmailAccountsTab from '@/components/crm/EmployeeEmailAccountsTab';
import EmployeePermissionsTab from '@/components/crm/EmployeePermissionsTab';
import EmployeeQualificationsTab from '@/components/crm/EmployeeQualificationsTab';
import { Formik, Form } from 'formik';
import { ImageEditorField } from '@/components/ImageEditorField';
import { AvatarEditorModal } from '@/components/AvatarEditorModal';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';
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
  personal_email: string | null;
  notification_email_preference: 'work' | 'personal' | 'both' | 'none';
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
  created_at: string;
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
  const [showAvatarPositionEditor, setShowAvatarPositionEditor] = useState(false);
  const [accessLevels, setAccessLevels] = useState<
    Array<{ id: string; name: string; description: string }>
  >([]);

  const {
    employee: currentEmployee,
    isAdmin,
    canManagePermissions,
    canManageModule,
    loading: currentUserLoading,
  } = useCurrentEmployee();

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
  const isOwnProfile = currentEmployee?.id === employeeId;
  const canViewOwnProfile = isOwnProfile || canEdit || isAdmin;

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
    // Table employee_documents doesn't exist yet - skip for now
    setDocuments([]);
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
        .from('employee_assignments')
        .select('*, event:events(id, name, event_date, status)')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });

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
      const dataToUpdate = { ...editedData };

      if (isOwnProfile && !canEdit) {
        delete dataToUpdate.role;
        delete dataToUpdate.access_level;
        delete dataToUpdate.permissions;
      }

      const { error } = await supabase.from('employees').update(dataToUpdate).eq('id', employeeId);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      setEmployee({ ...employee, ...dataToUpdate } as Employee);
      setIsEditing(false);
    } catch (err) {
      console.error('Error updating employee:', err);
      alert('Błąd podczas zapisywania zmian');
    }
  };

  const handleSaveImage = async (
    imageType: 'avatar' | 'background',
    payload: { file?: File; image: IUploadImage },
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
            position: payload.image.image_metadata?.desktop?.position || {
              posX: 0,
              posY: 0,
              scale: 1,
            },
            objectFit:
              payload.image.image_metadata?.desktop?.objectFit ||
              (imageType === 'avatar' ? 'contain' : 'cover'),
          },
          mobile: {
            src: imageUrl,
            position: payload.image.image_metadata?.mobile?.position || {
              posX: 0,
              posY: 0,
              scale: 1,
            },
            objectFit:
              payload.image.image_metadata?.mobile?.objectFit ||
              (imageType === 'avatar' ? 'contain' : 'cover'),
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

      const { error } = await supabase.from('employees').update(updateData).eq('id', employeeId);

      if (error) throw error;

      await fetchEmployeeDetails();
    } catch (err) {
      console.error('Error saving image:', err);
      throw err;
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    // Table employee_documents doesn't exist yet
    alert('Funkcja dokumentów nie jest jeszcze dostępna');
  };

  const handleSaveAvatarPosition = async (metadata: ImageMetadata) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ avatar_metadata: metadata })
        .eq('id', employeeId);

      if (error) throw error;

      if (employee) {
        setEmployee({ ...employee, avatar_metadata: metadata });
      }
    } catch (error) {
      console.error('Error saving avatar position:', error);
      throw error;
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
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex h-64 items-center justify-center">
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
          className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
        >
          <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-light text-[#e5e4e2]">
            {employee.name} {employee.surname}
          </h2>
          <p className="text-sm text-[#e5e4e2]/60">
            {employee.occupation || getRoleLabel(employee.role)}
          </p>
        </div>
        {(canEdit || isOwnProfile) && !isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Edit className="h-4 w-4" />
            Edytuj
          </button>
        ) : isEditing ? (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setEditedData(employee);
              }}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              <X className="h-4 w-4" />
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
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
              <div
                className="relative h-48 overflow-hidden rounded-t-xl"
                style={{ zIndex: isEditing ? 100 : 1 }}
              >
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
                  <div className="relative">
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
                    {canEdit && employee.avatar_url && (
                      <button
                        onClick={() => setShowAvatarPositionEditor(true)}
                        className="absolute -bottom-2 -right-2 rounded-full bg-[#d3bb73] p-2 text-[#1c1f33] shadow-lg transition-colors hover:bg-[#d3bb73]/90"
                        title="Ustaw pozycję avatara"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-6 pb-6 pt-20">
                <div className="mb-4 flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${
                      employee.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {employee.is_active ? 'Aktywny' : 'Nieaktywny'}
                  </span>
                  <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs text-blue-400">
                    <Shield className="mr-1 inline h-3 w-3" />
                    {getAccessLevelLabel(employee.access_level)}
                  </span>
                  <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs text-purple-400">
                    {getRoleLabel(employee.role)}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Mail className="h-4 w-4" />
                    <span>{employee.email}</span>
                  </div>
                  {employee.phone_number && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <Phone className="h-4 w-4" />
                      <span>{employee.phone_number}</span>
                    </div>
                  )}
                  {employee.region && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <MapPin className="h-4 w-4" />
                      <span>{employee.region}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Form>
        )}
      </Formik>

      <div className="flex gap-2 overflow-x-auto border-b border-[#d3bb73]/10">
        {[
          { id: 'overview', label: 'Przegląd', icon: User },
          ...(isAdmin ? [{ id: 'qualifications', label: 'Kwalifikacje', icon: Award }] : []),
          ...(isAdmin ? [{ id: 'emails', label: 'Konta Email', icon: Mail }] : []),
          ...(isAdmin ? [{ id: 'permissions', label: 'Uprawnienia', icon: Lock }] : []),
          ...(currentEmployee?.id === employeeId || isAdmin || canEdit
            ? [{ id: 'documents', label: 'Dokumenty', icon: FileText }]
            : []),
          ...(currentEmployee?.id === employeeId
            ? [{ id: 'tasks', label: 'Zadania', icon: CheckSquare }]
            : []),
          { id: 'events', label: 'Wydarzenia', icon: Calendar },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 transition-colors ${
              activeTab === tab.id
                ? 'border-[#d3bb73] text-[#d3bb73]'
                : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'qualifications' && isAdmin && (
        <EmployeeQualificationsTab employeeId={employeeId} canEdit={canEdit} />
      )}

      {activeTab === 'emails' && isAdmin && (
        <EmployeeEmailAccountsTab
          employeeId={employeeId}
          employeeEmail={employee.email}
          isAdmin={isAdmin}
        />
      )}

      {activeTab === 'permissions' && isAdmin && (
        <EmployeePermissionsTab
          employeeId={employeeId}
          isAdmin={isAdmin}
          targetEmployeeRole={employee?.role}
          currentEmployeeId={currentEmployee?.id}
        />
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h3>
            <div className="space-y-3">
              {isEditing ? (
                <>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Imię</label>
                    <input
                      type="text"
                      value={editedData.name || ''}
                      onChange={(e) => setEditedData({ ...editedData, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Nazwisko</label>
                    <input
                      type="text"
                      value={editedData.surname || ''}
                      onChange={(e) => setEditedData({ ...editedData, surname: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Pseudonim</label>
                    <input
                      type="text"
                      value={editedData.nickname || ''}
                      onChange={(e) => setEditedData({ ...editedData, nickname: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Email służbowy</label>
                    <input
                      type="email"
                      value={editedData.email || ''}
                      onChange={(e) => setEditedData({ ...editedData, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  {isAdmin && (
                    <>
                      <div>
                        <label className="text-xs text-[#e5e4e2]/60">Email prywatny</label>
                        <input
                          type="email"
                          value={editedData.personal_email || ''}
                          onChange={(e) =>
                            setEditedData({ ...editedData, personal_email: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                          placeholder="Opcjonalnie"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#e5e4e2]/60">
                          Powiadomienia email wysyłać na
                        </label>
                        <select
                          value={editedData.notification_email_preference || 'work'}
                          onChange={(e) =>
                            setEditedData({
                              ...editedData,
                              notification_email_preference: e.target.value as
                                | 'work'
                                | 'personal'
                                | 'both'
                                | 'none',
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                        >
                          <option value="work">Email służbowy</option>
                          <option value="personal">Email prywatny</option>
                          <option value="both">Oba emaile</option>
                          <option value="none">Nie wysyłaj emaili</option>
                        </select>
                        <p className="mt-1 text-xs text-[#e5e4e2]/40">
                          {editedData.notification_email_preference === 'personal' &&
                            'Wymaga ustawienia emaila prywatnego'}
                          {editedData.notification_email_preference === 'both' &&
                            'Wymaga ustawienia emaila prywatnego'}
                          {editedData.notification_email_preference === 'none' &&
                            'Powiadomienia będą tylko w systemie'}
                        </p>
                      </div>
                    </>
                  )}
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
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
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
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
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
                        className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                      >
                        <option value="">Brak roli</option>
                        {accessLevels.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.name}
                          </option>
                        ))}
                      </select>
                      {editedData.access_level_id &&
                        accessLevels.find((l) => l.id === editedData.access_level_id) && (
                          <p className="mt-1 text-xs text-[#e5e4e2]/40">
                            {
                              accessLevels.find((l) => l.id === editedData.access_level_id)
                                ?.description
                            }
                          </p>
                        )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <InfoRow label="Imię" value={employee.name} />
                  <InfoRow label="Nazwisko" value={employee.surname} />
                  {employee.nickname && <InfoRow label="Pseudonim" value={employee.nickname} />}
                  <InfoRow label="Email służbowy" value={employee.email} />
                  {isAdmin && employee.personal_email && (
                    <InfoRow label="Email prywatny" value={employee.personal_email} />
                  )}
                  {isAdmin && employee.notification_email_preference && (
                    <InfoRow
                      label="Powiadomienia email"
                      value={
                        employee.notification_email_preference === 'work'
                          ? 'Email służbowy'
                          : employee.notification_email_preference === 'personal'
                            ? 'Email prywatny'
                            : employee.notification_email_preference === 'both'
                              ? 'Oba emaile'
                              : 'Nie wysyłaj emaili'
                      }
                    />
                  )}
                  {employee.phone_number && (
                    <InfoRow label="Telefon" value={employee.phone_number} />
                  )}
                  {employee.phone_private && (
                    <InfoRow label="Telefon prywatny" value={employee.phone_private} />
                  )}
                  {employee.occupation && (
                    <InfoRow label="Stanowisko" value={employee.occupation} />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Adres</h3>
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
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[#e5e4e2]/60">Kod pocztowy</label>
                      <input
                        type="text"
                        value={editedData.address_postal_code || ''}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            address_postal_code: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
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
                        className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[#e5e4e2]/60">Region</label>
                    <input
                      type="text"
                      value={editedData.region || ''}
                      onChange={(e) => setEditedData({ ...editedData, region: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
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
                  {employee.region && <InfoRow label="Region" value={employee.region} />}
                  {!employee.address_street && !employee.address_city && !employee.region && (
                    <p className="text-sm text-[#e5e4e2]/40">Brak danych adresowych</p>
                  )}
                </>
              )}
            </div>
          </div>

          {employee.skills && employee.skills.length > 0 && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Umiejętności</h3>
              <div className="flex flex-wrap gap-2">
                {employee.skills.map((skill, idx) => (
                  <span
                    key={idx}
                    className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-sm text-[#d3bb73]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Website Visibility Section */}
          {isAdmin && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Widoczność na stronie</h3>
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
                      className="h-5 w-5 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <label htmlFor="show_on_website" className="text-[#e5e4e2]">
                      Wyświetl na stronie /zespół
                    </label>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-[#e5e4e2]/60">
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
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-[#e5e4e2]/40">
                      Niższa liczba = wyżej na liście. Admini mają automatycznie 0.
                    </p>
                  </div>

                  {editedData.show_on_website && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">
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
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                          placeholder="Krótki opis do wyświetlenia na stronie..."
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-[#e5e4e2]/60">
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
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                            placeholder="https://linkedin.com/in/..."
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[#e5e4e2]/60">
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
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                            placeholder="https://instagram.com/..."
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[#e5e4e2]/60">
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
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
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
                          <p className="mb-1 text-xs text-[#e5e4e2]/60">Biografia</p>
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
          )}

          {employee.notes && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Notatki</h3>
              {isEditing ? (
                <textarea
                  value={editedData.notes || ''}
                  onChange={(e) => setEditedData({ ...editedData, notes: e.target.value })}
                  className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/70">{employee.notes}</p>
              )}
            </div>
          )}

          {emailAccounts.length > 0 && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
                <Mail className="h-5 w-5" />
                Konta Email
              </h3>
              <div className="space-y-2">
                {emailAccounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-2 text-[#e5e4e2]/80">
                    <Mail className="h-4 w-4 text-[#d3bb73]" />
                    <span>{account.email_address}</span>
                    {account.is_primary && (
                      <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
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
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-light text-[#e5e4e2]">Dokumenty</h3>
            <button
              onClick={() => setShowAddDocumentModal(true)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj dokument
            </button>
          </div>

          {documents.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak dokumentów</p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-[#d3bb73]" />
                      <div>
                        <h4 className="font-medium text-[#e5e4e2]">{doc.name}</h4>
                        {doc.description && (
                          <p className="text-sm text-[#e5e4e2]/60">{doc.description}</p>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-[#e5e4e2]/40">
                            {new Date(doc.uploaded_at).toLocaleDateString('pl-PL')}
                          </span>
                          {doc.expiry_date && (
                            <>
                              <span className="text-xs text-[#e5e4e2]/40">•</span>
                              <span
                                className={`text-xs ${
                                  new Date(doc.expiry_date) < new Date()
                                    ? 'text-red-400'
                                    : 'text-[#e5e4e2]/40'
                                }`}
                              >
                                Ważny do: {new Date(doc.expiry_date).toLocaleDateString('pl-PL')}
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
                      className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
                    >
                      <Download className="h-4 w-4 text-[#d3bb73]" />
                    </a>
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
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
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-6 text-lg font-light text-[#e5e4e2]">Wydarzenia</h3>

          {events.length === 0 ? (
            <div className="py-12 text-center">
              <Calendar className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych wydarzeń</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((assignment) => (
                <div
                  key={assignment.id}
                  className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-all hover:border-[#d3bb73]/30"
                  onClick={() => router.push(`/crm/events/${assignment.event.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="mb-1 font-medium text-[#e5e4e2]">{assignment.event.name}</h4>
                      <p className="mb-2 text-sm text-[#d3bb73]">
                        Rola: {assignment.role_in_event}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[#e5e4e2]/60">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(assignment.event.event_date).toLocaleDateString('pl-PL')}
                        </span>
                        {assignment.hours_worked && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {assignment.hours_worked}h
                          </span>
                        )}
                        {assignment.hourly_rate && (
                          <span>Stawka: {assignment.hourly_rate} zł/h</span>
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

      {showAvatarPositionEditor && employee?.avatar_url && (
        <ImagePositionEditor
          imageUrl={employee.avatar_url}
          currentMetadata={employee.avatar_metadata}
          onSave={handleSaveAvatarPosition}
          onClose={() => setShowAvatarPositionEditor(false)}
          title="Ustaw pozycję avatara"
          previewAspectRatio="1/1"
          previewWidth={200}
          previewHeight={200}
          showCircularPreview={true}
        />
      )}
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
      // Table employee_documents doesn't exist yet
      alert('Funkcja dokumentów nie jest jeszcze dostępna');
      onClose();
    } catch (err) {
      console.error('Error adding document:', err);
      alert('Błąd podczas dodawania dokumentu');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <h2 className="mb-6 text-xl font-light text-[#e5e4e2]">Dodaj dokument</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa dokumentu *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="np. Umowa zlecenie 2025"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ dokumentu</label>
            <select
              value={formData.document_type}
              onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
            >
              <option value="contract">Umowa</option>
              <option value="certificate">Certyfikat</option>
              <option value="id_document">Dokument tożsamości</option>
              <option value="other">Inny</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">URL pliku *</label>
            <input
              type="url"
              value={formData.file_url}
              onChange={(e) => setFormData({ ...formData, file_url: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data ważności</label>
            <input
              type="date"
              value={formData.expiry_date}
              onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
