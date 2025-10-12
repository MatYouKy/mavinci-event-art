'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, User, Mail, Phone, MapPin, Briefcase, Shield, Calendar, FileText, CheckSquare, Clock, CreditCard as Edit, Save, X, Plus, Trash2, Upload, Download, Camera, Image as ImageIcon, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmployeeEmailAccountsTab from '@/components/crm/EmployeeEmailAccountsTab';
import EmployeePermissionsTab from '@/components/crm/EmployeePermissionsTab';
import { EmployeeImageEditor } from '@/components/EmployeeImageEditor';

interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  position?: ImagePosition;
  object_fit?: 'cover' | 'contain' | 'fill' | 'scale-down';
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<Partial<Employee>>({});
  const [showAddDocumentModal, setShowAddDocumentModal] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>('operator');

  useEffect(() => {
    if (employeeId) {
      fetchEmployeeDetails();
      fetchDocuments();
      fetchTasks();
      fetchEvents();
      checkUserRole();
    }
  }, [employeeId]);

  const checkUserRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No authenticated user');
        setCurrentUserRole('guest');
        return;
      }

      console.log('Supabase user:', user);
      console.log('User metadata:', user.user_metadata);
      console.log('App metadata:', user.app_metadata);

      const role = user.user_metadata?.role || user.app_metadata?.role || 'admin';
      console.log('Determined role:', role);
      setCurrentUserRole(role);
    } catch (err) {
      console.error('Error checking user role:', err);
      setCurrentUserRole('guest');
    }
  };

  const isAdmin = ['admin', 'manager', 'event_manager'].includes(currentUserRole);

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
      console.error('Error fetching documents:', err);
    }
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('task_assignments')
        .select('*, tasks(*)')
        .eq('employee_id', employeeId);

      if (!error && data) {
        setTasks(data.map((item: any) => item.tasks).filter(Boolean));
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
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

  const handleSave = async () => {
    if (!isAdmin) {
      alert('Tylko administrator może edytować dane pracowników');
      return;
    }

    try {
      const { error } = await supabase
        .from('employees')
        .update(editedData)
        .eq('id', employeeId);

      if (error) throw error;

      setEmployee({ ...employee, ...editedData } as Employee);
      setIsEditing(false);
    } catch (err) {
      console.error('Error updating employee:', err);
      alert('Błąd podczas zapisywania zmian');
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
        {isAdmin && !isEditing ? (
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

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
        <div className="relative h-32 bg-gradient-to-r from-[#d3bb73]/20 to-[#d3bb73]/5 group">
          {employee.background_image_url && (
            <div className="absolute inset-0 overflow-hidden">
              <img
                src={employee.background_image_url}
                alt="Background"
                className="w-full h-full"
                style={{
                  objectFit: employee.background_metadata?.object_fit || 'cover',
                  transform: `translate(${employee.background_metadata?.position?.posX || 0}%, ${employee.background_metadata?.position?.posY || 0}%) scale(${employee.background_metadata?.position?.scale || 1})`,
                }}
              />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#1c1f33]/50" />
          {isAdmin && (
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <EmployeeImageEditor
                employeeId={employeeId}
                currentImageUrl={employee.background_image_url}
                metadata={employee.background_metadata}
                onUpdate={fetchEmployeeDetails}
                imageType="background"
                title="Zmień tło"
              />
            </div>
          )}
          <div className="absolute -bottom-12 left-6 group">
            {employee.avatar_url ? (
              <div className="w-24 h-24 rounded-full border-4 border-[#1c1f33] overflow-hidden">
                <img
                  src={employee.avatar_url}
                  alt={`${employee.name} ${employee.surname}`}
                  className="w-full h-full"
                  style={{
                    objectFit: employee.avatar_metadata?.object_fit || 'cover',
                    transform: `translate(${employee.avatar_metadata?.position?.posX || 0}%, ${employee.avatar_metadata?.position?.posY || 0}%) scale(${employee.avatar_metadata?.position?.scale || 1})`,
                  }}
                />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-full border-4 border-[#1c1f33] bg-[#d3bb73]/20 flex items-center justify-center">
                <User className="w-12 h-12 text-[#d3bb73]" />
              </div>
            )}
            {isAdmin && (
              <div className="absolute bottom-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <EmployeeImageEditor
                  employeeId={employeeId}
                  currentImageUrl={employee.avatar_url}
                  metadata={employee.avatar_metadata}
                  onUpdate={fetchEmployeeDetails}
                  imageType="avatar"
                  title="Zmień zdjęcie"
                />
              </div>
            )}
          </div>
        </div>

        <div className="pt-16 px-6 pb-6">
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

      <div className="flex gap-2 border-b border-[#d3bb73]/10 overflow-x-auto">
        {[
          { id: 'overview', label: 'Przegląd', icon: User },
          { id: 'emails', label: 'Konta Email', icon: Mail },
          { id: 'permissions', label: 'Uprawnienia', icon: Lock },
          { id: 'documents', label: 'Dokumenty', icon: FileText },
          { id: 'tasks', label: 'Zadania', icon: CheckSquare },
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

      {activeTab === 'permissions' && (
        <EmployeePermissionsTab
          employeeId={employeeId}
          isAdmin={isAdmin}
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
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-6">
            Przypisane zadania
          </h3>

          {tasks.length === 0 ? (
            <div className="text-center py-12">
              <CheckSquare className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych zadań</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-[#e5e4e2] font-medium mb-1">
                        {task.title}
                      </h4>
                      {task.description && (
                        <p className="text-[#e5e4e2]/60 text-sm mb-2">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs ${getTaskStatusColor(
                            task.status
                          )}`}
                        >
                          {getTaskStatusLabel(task.status)}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs ${getPriorityColor(
                            task.priority
                          )}`}
                        >
                          {task.priority}
                        </span>
                        {task.due_date && (
                          <span className="text-[#e5e4e2]/40 text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(task.due_date).toLocaleDateString('pl-PL')}
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

