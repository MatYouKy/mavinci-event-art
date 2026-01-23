'use client';

import { useState, useEffect } from 'react';
import { Users, Mail, Quote, ArrowRight, MoreVertical } from 'lucide-react';

import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { PageHeroImage } from '@/components/PageHeroImage';
import WebsiteEditPanel from '@/components/WebsiteEditPanel';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { TeamMember } from '@/lib/supabase/types';
import { supabase } from '@/lib/supabase';

interface ImageMetadata {
  desktop?: {
    position?: {
      posX: number;
      posY: number;
      scale: number;
    };
    objectFit?: string;
  };
}

export default function TeamPageClient({ initialTeam }: { initialTeam: TeamMember[] }) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const {
    employee: currentEmployee,
    canManageModule,
    loading: employeeLoading,
  } = useCurrentEmployee();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>(initialTeam);
  const [loading, setLoading] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [editingMetadata, setEditingMetadata] = useState<ImageMetadata | null>(null);

  const canEdit = !employeeLoading && canManageModule && canManageModule('employees');

  const handleEditImagePosition = (member: TeamMember) => {
    setEditingMemberId(member.id);
    setEditingImageUrl(member.image || '');
    setEditingMetadata((member.image_metadata as ImageMetadata) || null);
  };

  const handleSavePosition = async (metadata: ImageMetadata) => {
    if (!editingMemberId) return;

    try {
      const { error } = await supabase.from('employees')
        .update({ team_page_metadata: metadata })
        .eq('id', editingMemberId);

      if (error) throw error;

      showSnackbar('Pozycja zdjęcia została zapisana!', 'success');

      setEditingMemberId(null);
      setEditingImageUrl(null);
      setEditingMetadata(null);
    } catch (error) {
      console.error('Error saving position:', error);
      showSnackbar('Błąd podczas zapisywania pozycji', 'error');
    }
  };

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="team"
          defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="overflow-hidden py-24 md:py-32"
        >
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                <Users className="h-5 w-5 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#d3bb73]">Poznaj Nasz Zespół</span>
              </div>

              <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                Ludzie, którzy tworzą <span className="text-[#d3bb73]">magię</span>
              </h1>

              <p className="mx-auto max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                Nasz zespół to grupa pasjonatów eventów, którzy łączą kreatywność z
                profesjonalizmem. Każdy z nas wnosi unikalne umiejętności i doświadczenie do
                wspólnych projektów.
              </p>
            </div>
          </div>
        </PageHeroImage>
        <section className="min-h-[50px] px-6 pt-6">
          <div className="mx-auto min-h-[50px] max-w-screen-lg">
            <CategoryBreadcrumb pageSlug="zespol" />
          </div>
        </section>

        <section className="bg-[#0f1119] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {isEditMode && !canEdit && (
              <div className="mb-8 rounded-xl border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-6">
                <div className="flex items-start gap-4">
                  <Users className="mt-1 h-6 w-6 flex-shrink-0 text-[#d3bb73]" />
                  <div>
                    <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">
                      Zarządzaj zespołem w CRM
                    </h3>
                    <p className="mb-4 text-[#e5e4e2]/70">
                      Ta strona wyświetla tylko pracowników oznaczonych jako &quot;widoczni na stronie&quot;.
                      Aby dodawać, edytować lub usuwać członków zespołu, przejdź do panelu CRM.
                    </p>
                    <a
                      href="/crm/employees"
                      className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      <Users className="h-4 w-4" />
                      Przejdź do zarządzania pracownikami
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-lg text-[#d3bb73]">Ładowanie zespołu...</div>
              </div>
            ) : team.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-[#e5e4e2]/60">Brak członków zespołu do wyświetlenia</p>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-8">
                {team.map((member, index) => (
                  <div
                    key={member.id}
                    className="group relative w-full overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30 md:w-[calc(50%-1rem)] lg:w-[calc(33.333%-1.33rem)]"
                    onMouseEnter={() => setHoveredId(member.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
                    }}
                  >
                    <div className="relative aspect-square overflow-hidden">
                      <img
                        src={member.image_metadata?.desktop?.src || member.image}
                        alt={member.alt || member.name}
                        className="transition-all duration-700"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: 'auto',
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
                      <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-95"></div>

                      {/* Edit button - visible only in edit mode for admins */}
                      {isEditMode && canEdit && (
                        <button
                          onClick={() => handleEditImagePosition(member)}
                          className="absolute right-4 top-4 z-20 rounded-full bg-[#d3bb73] p-2 shadow-lg transition-colors hover:bg-[#d3bb73]/90"
                          title="Edytuj pozycję zdjęcia"
                        >
                          <MoreVertical className="h-5 w-5 text-[#1c1f33]" />
                        </button>
                      )}

                      <div className="absolute bottom-0 left-0 right-0 p-6">
                        <h3 className="mb-1 text-xl font-light text-[#e5e4e2] md:text-2xl">
                          {member.name}
                        </h3>
                        <p className="mb-3 text-sm font-light text-[#d3bb73]">{member.position}</p>
                      </div>
                    </div>

                    <div className="p-6">
                      {member.email && (
                        <div className="flex gap-3">
                          <a
                            href={`mailto:${member.email}`}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                            aria-label={`Email ${member.name}`}
                          >
                            <Mail className="h-4 w-4" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <Quote className="mx-auto mb-6 h-12 w-12 text-[#d3bb73]" />
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Nasza Filozofia Pracy
              </h2>
              <div className="mx-auto mb-8 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
              <blockquote className="mx-auto max-w-4xl text-xl font-light italic leading-relaxed text-[#e5e4e2]/70">
                &quot;Wierzymy, że każdy event to szansa na stworzenie wyjątkowego doświadczenia. Łączymy
                pasję, kreatywność i profesjonalizm, aby przekraczać oczekiwania naszych klientów.&quot;
              </blockquote>
            </div>

            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/20">
                  <Users className="h-8 w-8 text-[#d3bb73]" />
                </div>
                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">Współpraca</h3>
                <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                  Pracujemy jako zgrany zespół, wspierając się nawzajem i dzieląc wiedzą.
                </p>
              </div>

              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/20">
                  <Quote className="h-8 w-8 text-[#d3bb73]" />
                </div>
                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">Kreatywność</h3>
                <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                  Każdy projekt to nowe wyzwanie, które rozwiązujemy z kreatywnością.
                </p>
              </div>

              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/20">
                  <ArrowRight className="h-8 w-8 text-[#d3bb73]" />
                </div>
                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">Rozwój</h3>
                <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                  Nieustannie się rozwijamy i śledzimy najnowsze trendy w branży eventowej.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#0f1119] py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <Users className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">Dołącz do Nas!</h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Szukasz pracy w dynamicznej branży eventowej? Chcesz realizować kreatywne projekty?
              Sprawdź nasze aktualne oferty pracy lub wyślij nam swoje CV.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt?career=true"
                className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Aplikuj teraz
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/portfolio"
                className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
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
      <WebsiteEditPanel />

      {/* Image Position Editor Modal */}
      {editingMemberId && editingImageUrl && (
        <ImagePositionEditor
          imageUrl={editingImageUrl}
          currentMetadata={editingMetadata}
          onSave={handleSavePosition}
          onClose={() => {
            setEditingMemberId(null);
            setEditingImageUrl(null);
            setEditingMetadata(null);
          }}
          title="Edytuj pozycję zdjęcia na stronie zespołu"
          previewAspectRatio="1/1"
          previewWidth={300}
          previewHeight={300}
          showCircularPreview={false}
        />
      )}
    </>
  );
}
