'use client';

import { useEffect, useState } from 'react';
import { Plus, CreditCard as Edit2, Trash2 } from 'lucide-react';
import { Formik, Form } from 'formik';
import { TeamMember } from '../lib/supabase';
import { ImageEditorField } from './ImageEditorField';
import { FormInput } from './formik/FormInput';
import { uploadImage } from '../lib/storage';
import { IUploadImage } from '../types/image';

export default function AdminTeamPanel() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/team-members');
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
          },
          mobile: {
            src: imageUrl,
            position: values.imageData.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
          },
        };
      }

      const payload = {
        name: values.name,
        role: values.role,
        image: imageUrl,
        alt: values.alt || '',
        image_metadata: imageMetadata,
        bio: values.bio || '',
        linkedin: values.linkedin || '',
        instagram: values.instagram || '',
        facebook: values.facebook || '',
        order_index: values.order_index,
      };

      if (isNew) {
        const response = await fetch('/api/team-members', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to create');
        setIsAdding(false);
      } else {
        const response = await fetch(`/api/team-members/${editingId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to update');
        setEditingId(null);
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
      role: member.role,
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
      image_metadata: member.image_metadata,
    };
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

      {isAdding && (
        <Formik
          initialValues={{
            name: '',
            role: '',
            image: '',
            alt: '',
            imageData: {} as IUploadImage,
            bio: '',
            linkedin: '',
            instagram: '',
            facebook: '',
            order_index: members.length,
            image_metadata: undefined,
          }}
          onSubmit={(values) => handleSave(values, true)}
        >
          {({ submitForm }) => (
            <Form className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
              <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Nowy Członek Zespołu</h3>

              <div className="mb-6">
                <ImageEditorField
                  fieldName="imageData"
                  isAdmin={true}
                  mode="vertical"
                  multiplier={1.33}
                  onSave={async () => {}}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput name="name" label="Imię i nazwisko" placeholder="Jan Kowalski" />
                <FormInput name="role" label="Stanowisko" placeholder="Event Manager" />
                <FormInput name="order_index" label="Kolejność" type="number" />
                <FormInput name="linkedin" label="LinkedIn URL (opcjonalnie)" />
                <FormInput name="instagram" label="Instagram URL (opcjonalnie)" />
                <FormInput name="facebook" label="Facebook URL (opcjonalnie)" />
                <div className="md:col-span-2">
                  <FormInput name="bio" label="Bio (opcjonalnie)" multiline rows={3} />
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={submitForm}
                  className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  Zapisz
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </Form>
          )}
        </Formik>
      )}

      <div className="grid grid-cols-1 gap-4">
        {members.map((member) => (
          <div key={member.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
            {editingId === member.id ? (
              <Formik
                initialValues={getMemberForEdit(member)}
                onSubmit={(values) => handleSave(values, false)}
              >
                {({ submitForm }) => (
                  <Form>
                    <div className="mb-6">
                      <ImageEditorField
                        fieldName="imageData"
                        isAdmin={true}
                        mode="vertical"
                        multiplier={1.33}
                        image={{
                          alt: member.alt,
                          image_metadata: member.image_metadata,
                        }}
                        onSave={async () => {}}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <FormInput name="name" label="Imię i nazwisko" />
                      <FormInput name="role" label="Stanowisko" />
                      <FormInput name="order_index" label="Kolejność" type="number" />
                      <FormInput name="bio" label="Bio" multiline rows={2} />
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={submitForm}
                        className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                      >
                        Zapisz
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                      >
                        Anuluj
                      </button>
                    </div>
                  </Form>
                )}
              </Formik>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <img
                    src={member.image_metadata?.desktop?.src || member.image}
                    alt={member.alt || member.name}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                  <div>
                    <h3 className="text-lg font-medium text-[#e5e4e2]">{member.name}</h3>
                    <p className="text-[#d3bb73]">{member.role}</p>
                    <p className="text-sm text-[#e5e4e2]/60">Kolejność: {member.order_index}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingId(member.id)}
                    className="p-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(member.id)}
                    className="p-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
