'use client';

import { useEffect, useState } from 'react';
import { Plus, CreditCard as Edit2, Trash2, GripVertical, Save, X } from 'lucide-react';
import { Formik, Form } from 'formik';
import { supabase, TeamMember } from '../lib/supabase';
import { ImageEditorField } from './ImageEditorField';
import { FormInput } from './formik/FormInput';
import { uploadImage } from '../lib/storage';
import { IUploadImage } from '../types/image';
import Draggable from 'react-draggable';

export default function AdminTeamPanel() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draggedItem, setDraggedItem] = useState<TeamMember | null>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('order_index', { ascending: true });

      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error('Error fetching team members:', error);
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
        position: values.role,
        image: imageUrl,
        alt: values.alt || values.name,
        image_metadata: imageMetadata,
        bio: values.bio || '',
        email: values.email || null,
        linkedin: values.linkedin || null,
        instagram: values.instagram || null,
        facebook: values.facebook || null,
        order_index: values.order_index,
      };

      if (isNew) {
        const { error } = await supabase
          .from('team_members')
          .insert([payload]);

        if (error) throw error;
        setIsAdding(false);
      } else {
        const { error } = await supabase
          .from('team_members')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
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
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchMembers();
    } catch (error: any) {
      alert('Błąd podczas usuwania: ' + error.message);
    }
  };

  const handleDragStart = (member: TeamMember) => {
    setDraggedItem(member);
  };

  const handleDragOver = (e: React.DragEvent, targetMember: TeamMember) => {
    e.preventDefault();

    if (!draggedItem || draggedItem.id === targetMember.id) return;

    const newMembers = [...members];
    const draggedIndex = newMembers.findIndex(m => m.id === draggedItem.id);
    const targetIndex = newMembers.findIndex(m => m.id === targetMember.id);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      newMembers.splice(draggedIndex, 1);
      newMembers.splice(targetIndex, 0, draggedItem);

      const updatedMembers = newMembers.map((member, index) => ({
        ...member,
        order_index: index + 1
      }));

      setMembers(updatedMembers);
    }
  };

  const handleDragEnd = async () => {
    if (!draggedItem) return;

    try {
      const updates = members.map((member, index) => ({
        id: member.id,
        order_index: index + 1
      }));

      for (const update of updates) {
        await supabase
          .from('team_members')
          .update({ order_index: update.order_index })
          .eq('id', update.id);
      }

      setDraggedItem(null);
      fetchMembers();
    } catch (error: any) {
      alert('Błąd podczas zmiany kolejności: ' + error.message);
      fetchMembers();
    }
  };

  const getMemberForEdit = (member: TeamMember) => {
    return {
      name: member.name,
      role: member.role || member.position || '',
      image: member.image,
      alt: member.alt || '',
      imageData: {
        alt: member.alt || '',
        image_metadata: member.image_metadata,
      } as IUploadImage,
      bio: member.bio || '',
      email: member.email || '',
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
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzaj Zespołem</h2>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">Przeciągnij aby zmienić kolejność</p>
        </div>
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
            email: '',
            linkedin: '',
            instagram: '',
            facebook: '',
            order_index: members.length + 1,
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
                <FormInput name="email" label="Email (opcjonalnie)" placeholder="jan@mavinci.pl" />
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
                  className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Zapisz
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="flex items-center gap-2 px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Anuluj
                </button>
              </div>
            </Form>
          )}
        </Formik>
      )}

      <div className="space-y-4">
        {members.map((member) => (
          <div
            key={member.id}
            draggable={editingId !== member.id}
            onDragStart={() => handleDragStart(member)}
            onDragOver={(e) => handleDragOver(e, member)}
            onDragEnd={handleDragEnd}
            className={`bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 transition-all ${
              draggedItem?.id === member.id ? 'opacity-50' : 'opacity-100'
            } ${editingId !== member.id ? 'cursor-move hover:border-[#d3bb73]/40' : ''}`}
          >
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
                          image: member.image,
                          image_metadata: member.image_metadata,
                        }}
                        onSave={async () => {}}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <FormInput name="name" label="Imię i nazwisko" />
                      <FormInput name="role" label="Stanowisko" />
                      <FormInput name="email" label="Email" />
                      <FormInput name="order_index" label="Kolejność" type="number" />
                      <FormInput name="linkedin" label="LinkedIn URL" />
                      <FormInput name="instagram" label="Instagram URL" />
                      <FormInput name="facebook" label="Facebook URL" />
                      <div className="md:col-span-2">
                        <FormInput name="bio" label="Bio" multiline rows={3} />
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={submitForm}
                        className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                      >
                        <Save className="w-4 h-4" />
                        Zapisz
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="flex items-center gap-2 px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        Anuluj
                      </button>
                    </div>
                  </Form>
                )}
              </Formik>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <GripVertical className="w-6 h-6 text-[#d3bb73]/40" />
                  <img
                    src={member.image_metadata?.desktop?.src || member.image}
                    alt={member.alt || member.name}
                    className="w-16 h-16 rounded-full object-cover border-2 border-[#d3bb73]/20"
                  />
                  <div>
                    <h3 className="text-lg font-medium text-[#e5e4e2]">{member.name}</h3>
                    <p className="text-[#d3bb73]">{member.role || member.position}</p>
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
                    onClick={() => handleDelete(member.id!)}
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

      {members.length === 0 && !isAdding && (
        <div className="text-center py-12 bg-[#1c1f33]/50 rounded-xl border border-[#d3bb73]/10">
          <p className="text-[#e5e4e2]/60 mb-4">Brak członków zespołu</p>
          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Dodaj Pierwszego Członka
          </button>
        </div>
      )}
    </div>
  );
}
