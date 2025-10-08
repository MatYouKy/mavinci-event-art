'use client';

import { useState, useEffect } from 'react';
import { Users, Mail, Linkedin, Quote, ArrowRight, Edit, Plus, Trash2, Save, X, GripVertical } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { TeamMember } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import Draggable from 'react-draggable';
import { ImageEditorField } from '@/components/ImageEditorField';
import { Formik, Form, Field } from 'formik';
import { FormInput } from '@/components/formik/FormInput';
import { uploadImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';
import { PageHeroImage } from '@/components/PageHeroImage';

const MOCK_TEAM: TeamMember[] = [
  {
    id: 'mock-1',
    name: 'Anna Kowalska',
    position: 'CEO & Founder',
    image: 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=800',
    bio: 'Pasjonatka eventów z 15-letnim doświadczeniem w branży. Specjalizuje się w zarządzaniu dużymi projektami i budowaniu relacji z klientami.',
    email: 'anna.kowalska@mavinci.pl',
    order_index: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    name: 'Piotr Nowak',
    position: 'Creative Director',
    image: 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=800',
    bio: 'Kreatywny umysł stojący za najciekawszymi koncepcjami eventowymi. Łączy nowoczesne technologie z artystyczną wizją.',
    email: 'piotr.nowak@mavinci.pl',
    order_index: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-3',
    name: 'Maria Wiśniewska',
    position: 'Event Manager',
    image: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=800',
    bio: 'Ekspertka w planowaniu i koordynacji eventów. Dbała o każdy szczegół, zapewnia płynny przebieg każdego wydarzenia.',
    email: 'maria.wisniewska@mavinci.pl',
    order_index: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-4',
    name: 'Jakub Kamiński',
    position: 'Technical Director',
    image: 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=800',
    bio: 'Specjalista od techniki scenicznej i multimediów. Odpowiada za najwyższą jakość realizacji technicznej naszych eventów.',
    email: 'jakub.kaminski@mavinci.pl',
    order_index: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-5',
    name: 'Katarzyna Lewandowska',
    position: 'Marketing Manager',
    image: 'https://images.pexels.com/photos/762020/pexels-photo-762020.jpeg?auto=compress&cs=tinysrgb&w=800',
    bio: 'Odpowiedzialna za marketing i komunikację. Tworzy strategie promocyjne, które przyciągają uwagę i budują zasięgi.',
    email: 'katarzyna.lewandowska@mavinci.pl',
    order_index: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-6',
    name: 'Tomasz Dąbrowski',
    position: 'Production Manager',
    image: 'https://images.pexels.com/photos/1080213/pexels-photo-1080213.jpeg?auto=compress&cs=tinysrgb&w=800',
    bio: 'Koordynuje produkcję eventów od strony logistycznej. Zapewnia, że wszystkie elementy są na swoim miejscu we właściwym czasie.',
    email: 'tomasz.dabrowski@mavinci.pl',
    order_index: 6,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function TeamPage() {
  const { isEditMode } = useEditMode();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draggedItems, setDraggedItems] = useState<{[key: string]: {x: number, y: number}}>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const fetchTeam = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/team-members', { cache: 'no-store' });
      const data = await response.json();
      setTeam(data && data.length > 0 ? data : MOCK_TEAM);
    } catch (error) {
      console.error('Error fetching team:', error);
      setTeam(MOCK_TEAM);
    }
    setLoading(false);
  };

  const handleSave = async (values: any, isNew: boolean, memberId?: string) => {
    try {
      let imageUrl = values.image;
      let imageMetadata: any = {};

      console.log('[handleSave] values:', values);
      console.log('[handleSave] values.imageData:', values.imageData);

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
      } else if (values.imageData?.image_metadata) {
        imageMetadata = {
          desktop: {
            src: values.imageData.image_metadata?.desktop?.src || values.image || imageUrl,
            position: values.imageData.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: values.imageData.image_metadata?.mobile?.src || values.image || imageUrl,
            position: values.imageData.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
          },
        };
      } else {
        imageMetadata = {
          desktop: {
            src: values.image || imageUrl,
            position: values.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: values.image || imageUrl,
            position: values.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
          },
        };
      }

      console.log('[handleSave] imageMetadata do zapisu:', imageMetadata);

      const payload = {
        name: values.name,
        role: values.role || values.position,
        position: values.position || values.role,
        image: imageUrl,
        alt: values.imageData?.alt || values.alt || '',
        image_metadata: imageMetadata,
        email: values.email || '',
        order_index: parseInt(values.order_index) || 0,
      };

      console.log('[handleSave] payload:', JSON.stringify(payload, null, 2));

      if (isNew) {
        const response = await fetch('/api/team-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        console.log('[handleSave] response status:', response.status);
        if (!response.ok) {
          const errorText = await response.text();
          console.error('API Error response:', errorText);
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          throw new Error(errorData.error || 'Failed to create');
        }
        setIsAdding(false);
      } else {
        const response = await fetch(`/api/team-members/${memberId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        console.log('[handleSave] response status:', response.status);
        if (!response.ok) {
          const errorText = await response.text();
          console.error('API Error response:', errorText);
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          throw new Error(errorData.error || 'Failed to update');
        }
        setEditingId(null);
      }

      await fetchTeam();
    } catch (error: any) {
      console.error('Save error:', error);
      alert('Błąd: ' + error.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego członka zespołu?')) return;

    try {
      const response = await fetch(`/api/team-members/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete');
      fetchTeam();
    } catch (error: any) {
      alert('Błąd: ' + error.message);
    }
  };

  const handleReorder = async () => {
    try {
      const updates = team.map((member, index) => ({
        id: member.id,
        order_index: index,
      }));

      for (const update of updates) {
        await fetch(`/api/team-members/${update.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_index: update.order_index }),
        });
      }
    } catch (error) {
      console.error('Error updating order:', error);
    }
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    const newTeam = [...team];
    const [movedItem] = newTeam.splice(fromIndex, 1);
    newTeam.splice(toIndex, 0, movedItem);
    setTeam(newTeam);
    handleReorder();
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      moveItem(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  useEffect(() => {
    fetchTeam();
  }, [isEditMode]);

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="zespol-hero"
          defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Users className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Poznaj Nasz Zespół</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Ludzie, którzy tworzą <span className="text-[#d3bb73]">magię</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed max-w-3xl mx-auto">
                Nasz zespół to grupa pasjonatów eventów, którzy łączą kreatywność z profesjonalizmem. Każdy z nas wnosi unikalne umiejętności i doświadczenie do wspólnych projektów.
              </p>
            </div>
          </div>
        </PageHeroImage>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {isEditMode && (
              <div className="mb-8 flex justify-end">
                <button
                  onClick={() => setIsAdding(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Dodaj Członka Zespołu
                </button>
              </div>
            )}

            {isAdding && isEditMode && (
              <div className="mb-8 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <Formik
                  initialValues={{
                    name: '',
                    position: '',
                    role: '',
                    image: '',
                    alt: '',
                    imageData: {} as IUploadImage,
                    email: '',
                    order_index: team.length,
                    image_metadata: undefined,
                  }}
                  onSubmit={(values) => handleSave(values, true)}
                >
                  {({ submitForm }) => (
                    <Form>
                      <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Nowy Członek Zespołu</h3>

                      <div className="mb-6">
                        <ImageEditorField
                          fieldName="imageData"
                          isAdmin={true}
                          mode="square"
                          multiplier={1}
                          onSave={async () => {}}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormInput name="name" label="Imię i nazwisko" placeholder="Jan Kowalski" />
                        <FormInput name="position" label="Stanowisko" placeholder="Event Manager" />
                        <FormInput name="email" label="Email" placeholder="jan@mavinci.pl" />
                        <FormInput name="order_index" label="Kolejność" type="number" />
                      </div>


                      <div className="flex gap-3 mt-4">
                        <button
                          type="button"
                          onClick={submitForm}
                          className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                        >
                          <Save className="w-4 h-4 inline mr-2" />
                          Zapisz
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAdding(false)}
                          className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                        >
                          <X className="w-4 h-4 inline mr-2" />
                          Anuluj
                        </button>
                      </div>
                    </Form>
                  )}
                </Formik>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-[#d3bb73] text-lg">Ładowanie zespołu...</div>
              </div>
            ) : team.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[#e5e4e2]/60">Brak członków zespołu do wyświetlenia</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {team.map((member, index) => (
                  editingId === member.id && isEditMode ? (
                    <div
                      key={member.id}
                      className="bg-[#1c1f33] border border-[#d3bb73]/30 rounded-xl p-6"
                    >
                      <Formik
                        enableReinitialize={false}
                        initialValues={{
                          name: member.name,
                          position: member.position || member.role || '',
                          role: member.role || member.position || '',
                          image: member.image,
                          alt: member.alt || '',
                          imageData: {
                            alt: member.alt,
                            image_metadata: {
                              desktop: {
                                src: member.image,
                                position: member.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
                              },
                              mobile: {
                                src: member.image,
                                position: member.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
                              },
                            },
                          } as any,
                          email: member.email || '',
                          order_index: member.order_index,
                          image_metadata: member.image_metadata,
                        }}
                        onSubmit={(values) => handleSave(values, false, member.id)}
                      >
                        {({ submitForm }) => (
                          <Form>
                            <div className="mb-4">
                              <ImageEditorField
                                fieldName="imageData"
                                isAdmin={true}
                                mode="vertical"
                                multiplier={1}
                                image={{
                                  alt: member.alt,
                                  image_metadata: {
                                    desktop: {
                                      src: member.image,
                                      position: member.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
                                    },
                                    mobile: {
                                      src: member.image,
                                      position: member.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
                                    },
                                  },
                                }}
                                onSave={submitForm}
                              />
                            </div>

                            <div className="space-y-3">
                              <FormInput name="name" label="Imię i nazwisko" />
                              <FormInput name="position" label="Stanowisko" />
                              <FormInput name="email" label="Email" />
                              <FormInput name="order_index" label="Kolejność" type="number" />
                            </div>

                            <div className="flex gap-2 mt-4">
                              <button
                                type="button"
                                onClick={submitForm}
                                className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 text-sm"
                              >
                                <Save className="w-4 h-4 inline mr-1" />
                                Zapisz
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="flex-1 px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 text-sm"
                              >
                                <X className="w-4 h-4 inline mr-1" />
                                Anuluj
                              </button>
                            </div>
                          </Form>
                        )}
                      </Formik>
                    </div>
                  ) : (
                  <div
                    key={member.id}
                    className={`group relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border rounded-2xl overflow-hidden transition-all duration-300 ${
                      isEditMode
                        ? 'border-[#d3bb73]/30 cursor-move'
                        : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                    }`}
                    onMouseEnter={() => setHoveredId(member.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    draggable={isEditMode}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    style={{
                      animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
                      opacity: draggedIndex === index ? 0.5 : 1,
                      border: dragOverIndex === index ? '2px solid #d3bb73' : undefined,
                    }}
                  >
                    {isEditMode && (
                      <div className="absolute top-2 left-2 z-20 bg-[#1c1f33]/90 rounded-lg p-1">
                        <GripVertical className="w-5 h-5 text-[#d3bb73]" />
                      </div>
                    )}
                    {isEditMode && (
                      <div className="absolute top-2 right-2 z-20 flex gap-2">
                        <button
                          onClick={() => setEditingId(member.id)}
                          className="p-2 bg-[#d3bb73]/20 backdrop-blur-sm text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(member.id)}
                          className="p-2 bg-[#800020]/20 backdrop-blur-sm text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <div className="aspect-square relative overflow-hidden">
                      <img
                        src={member.image_metadata?.desktop?.src || member.image}
                        alt={member.alt || member.name}
                        className="transition-all duration-700"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transform: `translate(${
                            member.image_metadata?.desktop?.position?.posX || 0
                          }%, ${
                            member.image_metadata?.desktop?.position?.posY || 0
                          }%) scale(${member.image_metadata?.desktop?.position?.scale || 1})`,
                          transformOrigin: 'center',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = `translate(${
                            member.image_metadata?.desktop?.position?.posX || 0
                          }%, ${
                            member.image_metadata?.desktop?.position?.posY || 0
                          }%) scale(${(member.image_metadata?.desktop?.position?.scale || 1) * 1.1})`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = `translate(${
                            member.image_metadata?.desktop?.position?.posX || 0
                          }%, ${
                            member.image_metadata?.desktop?.position?.posY || 0
                          }%) scale(${member.image_metadata?.desktop?.position?.scale || 1})`;
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 group-hover:opacity-95 transition-opacity duration-500"></div>

                      <div className="absolute bottom-0 left-0 right-0 p-6">
                        <h3 className="text-xl md:text-2xl font-light text-[#e5e4e2] mb-1">
                          {member.name}
                        </h3>
                        <p className="text-[#d3bb73] text-sm font-light mb-3">{member.position}</p>
                      </div>
                    </div>

                    <div className="p-6">
                      {member.email && (
                        <div className="flex gap-3">
                          <a
                            href={`mailto:${member.email}`}
                            className="flex items-center justify-center w-10 h-10 rounded-full bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] hover:bg-[#d3bb73]/20 transition-colors"
                            aria-label={`Email ${member.name}`}
                          >
                            <Mail className="w-4 h-4" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                  )
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <Quote className="w-12 h-12 text-[#d3bb73] mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Nasza Filozofia Pracy
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto mb-8"></div>
              <blockquote className="text-[#e5e4e2]/70 text-xl font-light italic leading-relaxed max-w-4xl mx-auto">
                "Wierzymy, że każdy event to szansa na stworzenie wyjątkowego doświadczenia. Łączymy pasję, kreatywność i profesjonalizm, aby przekraczać oczekiwania naszych klientów."
              </blockquote>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mt-12">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-[#d3bb73]" />
                </div>
                <h3 className="text-xl font-light text-[#e5e4e2] mb-3">Współpraca</h3>
                <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                  Pracujemy jako zgrany zespół, wspierając się nawzajem i dzieląc wiedzą.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center mx-auto mb-4">
                  <Quote className="w-8 h-8 text-[#d3bb73]" />
                </div>
                <h3 className="text-xl font-light text-[#e5e4e2] mb-3">Kreatywność</h3>
                <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                  Każdy projekt to nowe wyzwanie, które rozwiązujemy z kreatywnością.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center mx-auto mb-4">
                  <ArrowRight className="w-8 h-8 text-[#d3bb73]" />
                </div>
                <h3 className="text-xl font-light text-[#e5e4e2] mb-3">Rozwój</h3>
                <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                  Nieustannie się rozwijamy i śledzimy najnowsze trendy w branży eventowej.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Users className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Dołącz do Nas!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Szukasz pracy w dynamicznej branży eventowej? Chcesz realizować kreatywne projekty? Sprawdź nasze aktualne oferty pracy lub wyślij nam swoje CV.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                Skontaktuj się z nami
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="/portfolio"
                className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
              >
                Zobacz nasze projekty
              </a>
            </div>
          </div>
        </section>

        <style>{`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </main>
      <Footer />
    </>
  );
}
