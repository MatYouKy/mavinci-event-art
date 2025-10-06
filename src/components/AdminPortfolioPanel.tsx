'use client';

import { useEffect, useState } from 'react';
import { Plus, CreditCard as Edit2, Trash2 } from 'lucide-react';
import { Formik, Form } from 'formik';
import { PortfolioProject } from '../lib/supabase';
import { ImageEditorField } from './ImageEditorField';
import { FormInput } from './formik/FormInput';
import { uploadImage } from '../lib/storage';
import { IUploadImage } from '../types/image';

export default function AdminPortfolioPanel() {
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/portfolio-projects`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await response.json();
      setProjects(data?.projects || data || []);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
    setLoading(false);
  };

  const handleSave = async (values: any, isNew: boolean) => {
    try {
      let imageUrl = values.image;
      let imageMetadata = values.image_metadata;

      if (values.imageData?.file) {
        imageUrl = await uploadImage(values.imageData.file, 'portfolio');
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
        title: values.title,
        category: values.category,
        image: imageUrl,
        alt: values.alt || '',
        image_metadata: imageMetadata,
        description: values.description,
        order_index: values.order_index,
      };

      if (isNew) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/portfolio-projects`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to create');
        setIsAdding(false);
      } else {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/portfolio-projects/${editingId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Failed to update');
        setEditingId(null);
      }

      fetchProjects();
    } catch (error: any) {
      alert('Błąd: ' + error.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten projekt?')) {
      return;
    }

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/portfolio-projects/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (!response.ok) throw new Error('Failed to delete');
      fetchProjects();
    } catch (error: any) {
      alert('Błąd podczas usuwania: ' + error.message);
    }
  };

  const getProjectForEdit = (project: PortfolioProject) => {
    return {
      title: project.title,
      category: project.category,
      image: project.image,
      alt: project.alt || '',
      imageData: {
        alt: project.alt || '',
        image_metadata: project.image_metadata,
      } as IUploadImage,
      description: project.description,
      order_index: project.order_index,
      image_metadata: project.image_metadata,
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
        <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzaj Portfolio</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Dodaj Projekt
        </button>
      </div>

      {isAdding && (
        <Formik
          initialValues={{
            title: '',
            category: '',
            image: '',
            alt: '',
            imageData: {} as IUploadImage,
            description: '',
            order_index: projects.length,
            image_metadata: undefined,
          }}
          onSubmit={(values) => handleSave(values, true)}
        >
          {({ submitForm }) => (
            <Form className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
              <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Nowy Projekt</h3>

              <div className="mb-6">
                <ImageEditorField
                  fieldName="imageData"
                  isAdmin={true}
                  mode="vertical"
                  multiplier={1.25}
                  onSave={async () => {}}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormInput name="title" label="Tytuł projektu" placeholder="Gala Biznesowa 2024" />
                <FormInput name="category" label="Kategoria" placeholder="Corporate Event" />
                <FormInput name="order_index" label="Kolejność" type="number" />
                <div className="md:col-span-2">
                  <FormInput name="description" label="Opis projektu" multiline rows={3} />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => {
          const projectId = project._id || project.id || '';
          return (
          <div key={projectId} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden">
            {editingId === projectId ? (
              <Formik
                initialValues={getProjectForEdit(project)}
                onSubmit={(values) => handleSave(values, false)}
              >
                {({ submitForm }) => (
                  <Form className="p-6">
                    <div className="mb-6">
                      <ImageEditorField
                        fieldName="imageData"
                        isAdmin={true}
                        mode="vertical"
                        multiplier={1.25}
                        image={{
                          alt: project.alt,
                          image_metadata: project.image_metadata,
                        }}
                        onSave={async () => {}}
                      />
                    </div>

                    <div className="space-y-4 mb-4">
                      <FormInput name="title" label="Tytuł" />
                      <FormInput name="category" label="Kategoria" />
                      <FormInput name="order_index" label="Kolejność" type="number" />
                      <FormInput name="description" label="Opis" multiline rows={2} />
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
              <>
                <div className="aspect-[4/5] relative overflow-hidden">
                  <img
                    src={project.image_metadata?.desktop?.src || project.image}
                    alt={project.alt || project.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">{project.title}</h3>
                      <p className="text-[#d3bb73] text-sm">{project.category}</p>
                      <p className="text-sm text-[#e5e4e2]/60 mt-1">Kolejność: {project.order_index}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingId(projectId)}
                        className="p-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(projectId)}
                        className="p-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[#e5e4e2]/70 line-clamp-2">{project.description}</p>
                </div>
              </>
            )}
          </div>
        )})}
      </div>
    </div>
  );
}
