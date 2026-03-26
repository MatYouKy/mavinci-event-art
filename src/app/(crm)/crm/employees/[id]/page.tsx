/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Lock,
  Award,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import EmployeeEmailAccountsTab from '@/components/crm/EmployeeEmailAccountsTab';
import EmployeePermissionsTab from '@/components/crm/EmployeePermissionsTab';
import EmployeeQualificationsTab from '@/components/crm/EmployeeQualificationsTab';
import { Formik, Form } from 'formik';
import { ImageEditorField } from '@/components/ImageEditorField';
import { AvatarEditorModal } from '@/components/AvatarEditorModal';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';
import { uploadImage } from '@/lib/storage';
import { IUploadImage, IImage, IImageMetadataUpload } from '@/types/image';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import PrivateTasksBoardTab from '@/components/crm/employee/tabs/PrivateTasksBoardTab';
import EmployeeTimelineTab from '@/components/crm/employee/tabs/EmployeeTimelineTab';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { AddDocumentModal } from '@/components/crm/employee/modal/AddDocumentModal';
import EmployeeEventsTab from '@/components/crm/employee/tabs/EmployeeEventsTab';
import { EmployeeDocumentsTab } from '@/components/crm/employee/tabs/EmployeeDocumentsTab';
import EmployeeOverviewTab from '@/components/crm/employee/tabs/EmployeeOverviewTab';

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
    canManageModule,
    canViewModule,
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

  const profileActions = useMemo<Action[]>(() => {
    const canEditHere = (canEdit || isOwnProfile) === true;

    // nie ma uprawnień -> brak akcji
    if (!canEditHere) return [];

    // tryb podglądu
    if (!isEditing) {
      return [
        {
          label: 'Edytuj',
          onClick: () => setIsEditing(true),
          icon: <Edit className="h-4 w-4" />,
          variant: 'primary',
          show: true,
        },
      ];
    }

    // tryb edycji
    return [
      {
        label: 'Zapisz',
        onClick: handleSave,
        icon: <Save className="h-4 w-4" />,
        variant: 'primary',
        show: true,
      },
      {
        label: 'Anuluj',
        onClick: () => {
          setIsEditing(false);
          setEditedData(employee);
        },
        icon: <X className="h-4 w-4" />,
        variant: 'danger',
        show: true,
      },
    ];
  }, [canEdit, isOwnProfile, isEditing, handleSave, employee]);

  const handleSaveImage = async (
    imageType: 'avatar' | 'background',
    payload: { file?: File; image: IUploadImage | IImage },
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

  const backgroundImageData: IImageMetadataUpload = {
    desktop: {
      src: employee.background_image_url,
      position: employee.background_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
      objectFit: employee.background_metadata?.desktop?.objectFit || 'cover',
    },
    mobile: {
      src: employee.background_image_url,
      position: employee.background_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
      objectFit: employee.background_metadata?.mobile?.objectFit || 'cover',
    },
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
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
        <ResponsiveActionBar actions={profileActions} />
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
                  image={backgroundImageData as IUploadImage | IImage}
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
          ...(canViewOwnProfile ? [{ id: 'events', label: 'Wydarzenia', icon: Calendar }] : []),
          ...(canViewOwnProfile ? [{ id: 'timeline', label: 'Oś czasu', icon: Clock }] : []),
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
        <EmployeeOverviewTab
          employee={employee}
          editedData={editedData}
          setEditedData={setEditedData}
          isEditing={isEditing}
          isAdmin={isAdmin}
          accessLevels={accessLevels}
          emailAccounts={emailAccounts}
        />
      )}

      {activeTab === 'documents' && (
        <EmployeeDocumentsTab
          documents={documents}
          onAddDocument={() => setShowAddDocumentModal(true)}
          onDeleteDocument={handleDeleteDocument}
        />
      )}

      {activeTab === 'tasks' && (
        <PrivateTasksBoardTab
          employeeId={employeeId as string}
          isOwnProfile={currentEmployee?.id === employeeId}
          tasksState={tasks as unknown as any[]}
        />
      )}

      {activeTab === 'events' && (
        <EmployeeEventsTab
          events={events}
          onOpenEvent={(eventId) => router.push(`/crm/events/${eventId}`)}
        />
      )}

      {activeTab === 'timeline' && canViewOwnProfile && (
        <EmployeeTimelineTab employeeId={employeeId} canEdit={canEdit} />
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
