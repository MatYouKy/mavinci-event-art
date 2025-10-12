'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Formik, Form } from 'formik';
import { Dialog } from '@mui/material';
import { TeamMember } from '../lib/supabase';
import { ImageEditorField } from './ImageEditorField';
import { FormInput } from './formik/FormInput';
import { uploadImage } from '../lib/storage';
import { IUploadImage } from '../types/image';

export default function AdminTeamPanel() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/team-members?all=true');
      if (!response.ok) {
        throw new Error('Failed to fetch team members');
      }
      const data = await response.json();
      setMembers(data || []);
    } catch (error) {
      console.error('Error fetching team members:', error);
      setMembers([]);
    }
    setLoading(false);
  };

  const handleSave = async (values: any, isNew: boolean) => {
    try {
      let imageUrl = values.image;
      let imageMetadata = values.image_metadata;

      if (values.imageData?.file) {
        imageUrl = await uploadImage(values.imageData.file, 'team');
        imageMetadata = {
          desktop: {
            src: imageUrl,
            position: values.imageData.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
            objectFit: values.imageData.image_metadata?.desktop?.objectFit || 'cover',
          },
          mobile: {
            src: imageUrl,
            position: values.imageData.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
            objectFit: values.imageData.image_metadata?.mobile?.objectFit || 'cover',
          },
        };
      } else if (values.imageData?.image_metadata) {
        imageMetadata = {
          desktop: {
            src: values.imageData.image_metadata?.desktop?.src || values.image || imageUrl,
            position: values.imageData.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
            objectFit: values.imageData.image_metadata?.desktop?.objectFit || 'cover',
          },
          mobile: {
            src: values.imageData.image_metadata?.mobile?.src || values.image || imageUrl,
            position: values.imageData.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
            objectFit: values.imageData.image_metadata?.mobile?.objectFit || 'cover',
          },
        };
      }

      const payload = {
        name: values.name,
        position: values.position,
        role: values.role,
        email: values.email || '',
        image: imageUrl,
        alt: values.alt || values.name,
        image_metadata: imageMetadata,
        bio: values.bio || '',
        linkedin: values.linkedin || '',
        instagram: values.instagram || '',
        facebook: values.facebook || '',
        order_index: values.order_index,
        is_visible: values.is_visible !== undefined ? values.is_visible : true,
      };

      if (isNew) {
        const response = await fetch('/api/team-members', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Token': process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || 'mavinci-admin-secret-2025',
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to create');
        setIsAdding(false);
      } else {
        const response = await fetch(`/api/team-members/${editingMember?.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Token': process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || 'mavinci-admin-secret-2025',
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to update');
        setEditingMember(null);
      }

      fetchMembers();
    } catch (error: any) {
      alert('Błąd: ' + error.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego członka zespołu?')) {
      return;
    }

    try {
      const response = await fetch(`/api/team-members/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Admin-Token': process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || 'mavinci-admin-secret-2025',
        },
      });
      if (!response.ok) throw new Error('Failed to delete');
      fetchMembers();
    } catch (error: any) {
      alert('Błąd podczas usuwania: ' + error.message);
    }
  };

  const getMemberForEdit = (member: TeamMember) => {
    return {
      name: member.name,
      position: member.position || '',
      role: member.role || '',
      email: member.email || '',
      image: member.image,
      alt: member.alt || '',
      imageData: {
        alt: member.alt || '',
        image_metadata: member.image_metadata,
      } as IUploadImage,
      bio: member.bio || '',
      linkedin: member.linkedin || '',
      instagram: member.instagram || '',
      facebook: member.facebook || '',
      order_index: member.order_index,
      is_visible: member.is_visible !== undefined ? member.is_visible : true,
      image_metadata: member.image_metadata,
    };
  };

  const closeModal = () => {
    setEditingMember(null);
    setIsAdding(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzaj Zespołem</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Dodaj Członka
        </button>
      </div>

      {/* Modal for Add/Edit */}
      <Dialog
        open={isAdding || editingMember !== null}
        onClose={closeModal}
        maxWidth="md"
        fullWidth
        PaperProps={{
          style: {
            backgroundColor: '#1c1f33',
            border: '1px solid rgba(211, 187, 115, 0.2)',
            borderRadius: '12px',
            maxHeight: '90vh',
            overflow: 'auto',
          },
        }}
      >
        <Formik
          initialValues={
            editingMember
              ? getMemberForEdit(editingMember)
              : {
                  name: '',
                  position: '',
                  role: '',
                  email: '',
                  image: '',
                  alt: '',
                  imageData: {} as IUploadImage,
                  bio: '',
                  linkedin: '',
                  instagram: '',
                  facebook: '',
                  order_index: members.length + 1,
                  is_visible: true,
                  image_metadata: undefined,
                }
          }
          onSubmit={(values) => handleSave(values, !editingMember)}
          enableReinitialize
        >
          {({ submitForm, values }) => (
            <Form className="p-6">
              <h3 className="text-xl font-light text-[#e5e4e2] mb-6">
                {editingMember ? 'Edytuj Członka Zespołu' : 'Nowy Członek Zespołu'}
              </h3>

              <div className="mb-6">
                <label className="block text-sm font-medium text-[#d3bb73] mb-2">
                  Zdjęcie (proporcje 3:4)
                </label>
                <ImageEditorField
                  fieldName="imageData"
                  isAdmin={true}
                  mode="vertical"
                  multiplier={1.33}
                  image={
                    editingMember
                      ? {
                          alt: editingMember.alt,
                          image_metadata: editingMember.image_metadata,
                        }
                      : undefined
                  }
                  onSave={async () => {}}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <FormInput
                  name="name"
                  label="Imię i nazwisko"
                  placeholder="Roman Pażdzioch"
                  required
                />
                <FormInput name="position" label="Pozycja" placeholder="CEO" />
                <FormInput
                  name="role"
                  label="Rola"
                  placeholder="Creative Director"
                />
                <FormInput
                  name="email"
                  label="Email"
                  placeholder="email@mavinci.pl"
                  type="email"
                />
                <FormInput
                  name="linkedin"
                  label="LinkedIn URL"
                  placeholder="https://linkedin.com/in/..."
                />
                <FormInput
                  name="instagram"
                  label="Instagram URL"
                  placeholder="https://instagram.com/..."
                />
                <FormInput
                  name="facebook"
                  label="Facebook URL"
                  placeholder="https://facebook.com/..."
                />
                <FormInput
                  name="order_index"
                  label="Kolejność"
                  type="number"
                  placeholder="1"
                />
              </div>

              <div className="mb-6">
                <label className="flex items-center gap-2 text-[#e5e4e2] cursor-pointer">
                  <FormInput
                    name="is_visible"
                    type="checkbox"
                    label=""
                    style={{ width: 'auto', margin: 0 }}
                  />
                  <span>Widoczny na stronie głównej</span>
                </label>
              </div>

              <div className="mb-6">
                <FormInput
                  name="bio"
                  label="Biografia"
                  multiline
                  rows={4}
                  placeholder="Krótki opis osoby..."
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={submitForm}
                  className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
                >
                  Zapisz
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </Dialog>

      {/* Members List */}
      <div className="grid grid-cols-1 gap-4">
        {members.map((member) => (
          <div
            key={member.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-20 rounded-lg overflow-hidden bg-[#800020]/10">
                  <img
                    src={member.image_metadata?.desktop?.src || member.image}
                    alt={member.alt || member.name}
                    className="w-full h-full object-cover"
                    style={{
                      objectFit:
                        member.image_metadata?.desktop?.objectFit || 'cover',
                      transform: `translate(${
                        member.image_metadata?.desktop?.position?.posX || 0
                      }%, ${
                        member.image_metadata?.desktop?.position?.posY || 0
                      }%) scale(${
                        member.image_metadata?.desktop?.position?.scale || 1
                      })`,
                    }}
                  />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-[#e5e4e2]">
                    {member.name}
                  </h3>
                  <p className="text-[#d3bb73] text-sm">{member.position}</p>
                  {member.role && (
                    <p className="text-[#e5e4e2]/60 text-sm">{member.role}</p>
                  )}
                  <div className="flex items-center gap-4 mt-1">
                    <p className="text-xs text-[#e5e4e2]/60">
                      Kolejność: {member.order_index}
                    </p>
                    <p
                      className={`text-xs ${
                        member.is_visible
                          ? 'text-green-400'
                          : 'text-[#e5e4e2]/40'
                      }`}
                    >
                      {member.is_visible ? '✓ Widoczny' : '✗ Ukryty'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingMember(member)}
                  className="p-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                  title="Edytuj"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleDelete(member.id)}
                  className="p-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                  title="Usuń"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
