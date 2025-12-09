'use client';

import { useState, useEffect } from 'react';
import { Users, Mail, Quote, ArrowRight, MoreVertical } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { TeamMember, supabase } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { PageHeroImage } from '@/components/PageHeroImage';
import WebsiteEditPanel from '@/components/WebsiteEditPanel';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

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

export default function TeamPageClient() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee, canManageModule, loading: employeeLoading } = useCurrentEmployee();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [editingMetadata, setEditingMetadata] = useState<ImageMetadata | null>(null);

  const canEdit = !employeeLoading && canManageModule && canManageModule('employees');

  const fetchTeam = async () => {

    setLoading(true);
    try {
      // Fetch directly from Supabase instead of API route
      // This works during build time and runtime
      const { supabase } = await import('@/lib/supabase');

      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, email, avatar_url, team_page_metadata, role, occupation, show_on_website, website_bio, linkedin_url, instagram_url, facebook_url, order_index')
        .eq('show_on_website', true)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[fetchTeam] Supabase error:', error);
        showSnackbar('Błąd podczas pobierania zespołu', 'error');
        setTeam([]);
        return;
      }

      // Transform employees data to team members format
      const teamMembers = (data || []).map((emp: any) => ({
        id: emp.id,
        name: `${emp.name || ''} ${emp.surname || ''}`.trim() || emp.nickname || 'Pracownik',
        position: emp.occupation || emp.role || '',
        role: emp.role || emp.occupation || '',
        email: emp.email,
        image: emp.avatar_url,
        image_metadata: emp.team_page_metadata,
        alt: `${emp.name || ''} ${emp.surname || ''}`.trim(),
        bio: emp.website_bio,
        linkedin: emp.linkedin_url,
        instagram: emp.instagram_url,
        facebook: emp.facebook_url,
      }));

      setTeam(teamMembers as TeamMember[]);
    } catch (error) {
      console.error('[fetchTeam] Error:', error);
      setTeam([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const handleEditImagePosition = (member: TeamMember) => {
    setEditingMemberId(member.id);
    setEditingImageUrl(member.image || '');
    setEditingMetadata(member.image_metadata as ImageMetadata || null);
  };

  const handleSavePosition = async (metadata: ImageMetadata) => {
    if (!editingMemberId) return;

    try {
      const { error } = await supabase
        .from('employees')
        .update({ team_page_metadata: metadata })
        .eq('id', editingMemberId);

      if (error) throw error;

      showSnackbar('Pozycja zdjęcia została zapisana!', 'success');

      await fetchTeam();

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
        <section className="px-6 pt-6 min-h-[50px]">  
          <div className="mx-auto min-h-[50px] max-w-screen-lg">
            <CategoryBreadcrumb pageSlug="zespol" />
          </div>
        </section>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {isEditMode && !canEdit && (
              <div className="mb-8 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <Users className="w-6 h-6 text-[#d3bb73] flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-lg font-medium text-[#e5e4e2] mb-2">
                      Zarządzaj zespołem w CRM
                    </h3>
                    <p className="text-[#e5e4e2]/70 mb-4">
                      Ta strona wyświetla tylko pracowników oznaczonych jako "widoczni na stronie".
                      Aby dodawać, edytować lub usuwać członków zespołu, przejdź do panelu CRM.
                    </p>
                    <a
                      href="/crm/employees"
                      className="inline-flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                    >
                      <Users className="w-4 h-4" />
                      Przejdź do zarządzania pracownikami
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
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
              <div className="flex flex-wrap justify-center gap-8">
                {team.map((member, index) => (
                  <div
                    key={member.id}
                    className="group relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 rounded-2xl overflow-hidden transition-all duration-300 w-full md:w-[calc(50%-1rem)] lg:w-[calc(33.333%-1.33rem)]"
                    onMouseEnter={() => setHoveredId(member.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
                    }}
                  >
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
                      <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 group-hover:opacity-95 transition-opacity duration-500"></div>

                      {/* Edit button - visible only in edit mode for admins */}
                      {isEditMode && canEdit && (
                        <button
                          onClick={() => handleEditImagePosition(member)}
                          className="absolute top-4 right-4 z-20 p-2 bg-[#d3bb73] rounded-full hover:bg-[#d3bb73]/90 transition-colors shadow-lg"
                          title="Edytuj pozycję zdjęcia"
                        >
                          <MoreVertical className="w-5 h-5 text-[#1c1f33]" />
                        </button>
                      )}

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
                href="/#kontakt?career=true"
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                Aplikuj teraz
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
