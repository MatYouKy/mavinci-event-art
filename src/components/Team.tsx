'use client';

import { useState, useEffect } from 'react';
import { Linkedin, Mail, MoreVertical } from 'lucide-react';
import { TeamMember, supabase } from '../lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ImagePositionEditor from '@/components/crm/ImagePositionEditor';

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

export default function Team() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [editingMetadata, setEditingMetadata] = useState<ImageMetadata | null>(null);

  const { isEditMode } = useEditMode();
  const {
    employee: currentEmployee,
    canManageModule,
    loading: employeeLoading,
  } = useCurrentEmployee();
  const canEdit = !employeeLoading && canManageModule && canManageModule('employees');

  useEffect(() => {
    fetchTeamMembers();
  }, []);

  const fetchTeamMembers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employees')
        .select(
          'id, name, surname, nickname, email, avatar_url, avatar_metadata, team_page_metadata, occupation, role, website_bio, linkedin_url, instagram_url, facebook_url, order_index, access_level',
        )
        .eq('show_on_website', true)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      // Transform employees to team members format
      const transformed = (data || []).map((emp: any) => ({
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

      console.log('Fetched team members from employees:', transformed);
      setTeamMembers(transformed);
    } catch (error) {
      console.error('Error fetching team members:', error);
      setTeamMembers([]);
    }
    setLoading(false);
  };

  const handleEditImagePosition = (member: TeamMember) => {
    setEditingMemberId(member.id);
    setEditingImageUrl(member.image);
    setEditingMetadata(member.image_metadata as ImageMetadata | null);
  };

  const handleSaveImagePosition = async (metadata: ImageMetadata) => {
    if (!editingMemberId) return;

    try {
      const { error } = await supabase
        .from('employees')
        .update({ team_page_metadata: metadata })
        .eq('id', editingMemberId);

      if (error) throw error;

      await fetchTeamMembers();
      setEditingMemberId(null);
      setEditingImageUrl(null);
      setEditingMetadata(null);
    } catch (error) {
      console.error('Error saving image position:', error);
      throw error;
    }
  };

  return (
    <section className="relative overflow-hidden bg-[#1c1f33] py-24 md:py-32">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="team-dots"
              x="0"
              y="0"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern
              id="team-lines"
              x="0"
              y="0"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#team-dots)" />
          <rect width="100%" height="100%" fill="url(#team-lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-[#d3bb73] blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-[#800020] blur-3xl"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center md:mb-20">
          <div className="inline-block">
            <span className="mb-4 block animate-[fadeIn_0.6s_ease-out] text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
              Nasz Zespół
            </span>
            <h2 className="mb-6 animate-[fadeIn_0.8s_ease-out] text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl">
              Poznaj Ludzi za Sukcesem
            </h2>
            <div className="mx-auto h-1 w-24 animate-[scaleIn_1s_ease-out] bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg text-[#d3bb73]">Ładowanie zespołu...</div>
          </div>
        ) : teamMembers.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[#e5e4e2]/60">Brak członków zespołu do wyświetlenia</p>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-8">
            {teamMembers.map((member, index) => (
              <div
                key={member.id}
                className="group relative w-full sm:w-[calc(50%-1rem)] lg:w-[calc(25%-1.5rem)]"
                style={{
                  animation: `fadeInUp 0.6s ease-out ${index * 0.2}s both`,
                }}
                onMouseEnter={() => setHoveredId(member.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="relative overflow-hidden rounded-2xl">
                  <div
                    className="relative aspect-[3/4] bg-[#800020]/10"
                    style={{ overflow: 'hidden' }}
                  >
                    <img
                      src={member.image}
                      alt={member.alt || member.name}
                      className="transition-all duration-700"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: 'auto',
                        objectFit: member.image_metadata?.desktop?.objectFit || 'cover',
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
                        }%) scale(${(member.image_metadata?.desktop?.position?.scale || 1) * 1.1}) rotate(2deg)`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = `translate(${
                          member.image_metadata?.desktop?.position?.posX || 0
                        }%, ${
                          member.image_metadata?.desktop?.position?.posY || 0
                        }%) scale(${member.image_metadata?.desktop?.position?.scale || 1})`;
                      }}
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/40 to-transparent opacity-60 transition-all duration-500 group-hover:opacity-90"></div>

                    {/* Edit menu - visible only in edit mode */}
                    {isEditMode && canEdit && (
                      <button
                        onClick={() => handleEditImagePosition(member)}
                        className="absolute left-4 top-4 z-20 rounded-full bg-[#d3bb73] p-2 shadow-lg transition-colors hover:bg-[#d3bb73]/90"
                        title="Ustaw pozycję zdjęcia"
                      >
                        <MoreVertical className="h-5 w-5 text-[#1c1f33]" />
                      </button>
                    )}

                    <div
                      className={`absolute right-4 top-4 flex gap-2 transition-all duration-500 ${
                        hoveredId === member.id
                          ? 'translate-y-0 opacity-100'
                          : '-translate-y-4 opacity-0'
                      }`}
                    >
                      <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73] backdrop-blur-sm transition-all duration-300 hover:rotate-12 hover:scale-110 hover:bg-[#d3bb73]/80">
                        <Linkedin className="h-5 w-5 text-[#1c1f33]" />
                      </button>
                      <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73] backdrop-blur-sm transition-all duration-300 hover:rotate-12 hover:scale-110 hover:bg-[#d3bb73]/80">
                        <Mail className="h-5 w-5 text-[#1c1f33]" />
                      </button>
                    </div>

                    <div
                      className={`absolute bottom-0 left-0 right-0 transform p-6 transition-all duration-500 ${
                        hoveredId === member.id ? '-translate-y-4' : 'translate-y-0'
                      }`}
                    >
                      <h3 className="mb-1 text-xl font-light text-[#e5e4e2] transition-colors duration-300 group-hover:text-[#d3bb73] md:text-2xl">
                        {member.name}
                      </h3>
                      <p className="mb-3 text-sm font-light tracking-wide text-[#d3bb73]">
                        {member.position || member.role}
                      </p>
                      <p
                        className={`text-sm font-light leading-relaxed text-[#e5e4e2]/80 transition-all duration-500 ${
                          hoveredId === member.id
                            ? 'max-h-20 translate-y-0 opacity-100'
                            : 'max-h-0 translate-y-4 overflow-hidden opacity-0'
                        }`}
                      >
                        {member.bio}
                      </p>
                    </div>

                    <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-transparent transition-all duration-500 group-hover:border-[#d3bb73]/30"></div>
                  </div>
                </div>

                <div className="absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-br from-[#d3bb73]/0 via-[#d3bb73]/0 to-[#d3bb73]/0 opacity-0 blur-xl transition-all duration-700 group-hover:from-[#d3bb73]/20 group-hover:via-[#d3bb73]/5 group-hover:to-[#d3bb73]/20 group-hover:opacity-100"></div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-16 animate-[fadeIn_1.2s_ease-out] text-center">
          <p className="mx-auto mb-6 max-w-2xl text-base font-light text-[#e5e4e2]/70 md:text-lg">
            Nasz zespół to połączenie doświadczenia, kreatywności i pasji do tworzenia wyjątkowych
            wydarzeń
          </p>
          <button className="inline-flex items-center gap-2 rounded-full border-2 border-[#d3bb73] bg-transparent px-8 py-4 font-light text-[#d3bb73] transition-all duration-300 hover:scale-105 hover:bg-[#d3bb73] hover:text-[#1c1f33] hover:shadow-lg hover:shadow-[#d3bb73]/30">
            Dołącz do Zespołu
          </button>
        </div>
      </div>

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

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }
      `}</style>

      {/* Image Position Editor Modal */}
      {editingMemberId && editingImageUrl && (
        <ImagePositionEditor
          imageUrl={editingImageUrl}
          currentMetadata={editingMetadata}
          onSave={handleSaveImagePosition}
          onClose={() => {
            setEditingMemberId(null);
            setEditingImageUrl(null);
            setEditingMetadata(null);
          }}
          title="Ustaw pozycję zdjęcia zespołu"
          previewAspectRatio="3/4"
          previewWidth={300}
          previewHeight={400}
        />
      )}
    </section>
  );
}
