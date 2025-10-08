'use client';

import { useState, useEffect } from 'react';
import { Linkedin, Mail } from 'lucide-react';
import { TeamMember, supabase } from '../lib/supabase';

const MOCK_TEAM: TeamMember[] = [
  {
    id: 'mock-1',
    name: 'Anna Kowalska',
    role: 'Event Manager',
    position: 'Event Manager',
    image: 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=600',
    bio: 'Specjalistka od organizacji wydarzeń z 8-letnim doświadczeniem',
    linkedin: '',
    instagram: '',
    facebook: '',
    order_index: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    name: 'Marek Nowak',
    role: 'Creative Director',
    position: 'Creative Director',
    image: 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=600',
    bio: 'Wizjoner i twórca niezapomnianych koncepcji eventowych',
    linkedin: '',
    instagram: '',
    facebook: '',
    order_index: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-3',
    name: 'Katarzyna Wiśniewska',
    role: 'PR Specialist',
    position: 'PR Specialist',
    image: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=600',
    bio: 'Ekspertka w budowaniu relacji z mediami i promocji wydarzeń',
    linkedin: '',
    instagram: '',
    facebook: '',
    order_index: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mock-4',
    name: 'Piotr Zieliński',
    role: 'Technical Director',
    position: 'Technical Director',
    image: 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=600',
    bio: 'Odpowiada za całą stronę techniczną i logistyczną eventów',
    linkedin: '',
    instagram: '',
    facebook: '',
    order_index: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function Team() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeamMembers();
  }, []);

  const fetchTeamMembers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Fetched team members:', data);
      setTeamMembers(data && data.length > 0 ? data : MOCK_TEAM);
    } catch (error) {
      console.error('Error fetching team members:', error);
      setTeamMembers(MOCK_TEAM);
    }
    setLoading(false);
  };

  return (
    <section className="relative py-24 md:py-32 bg-[#1c1f33] overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="team-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern id="team-lines" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#team-dots)" />
          <rect width="100%" height="100%" fill="url(#team-lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#800020] rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16 md:mb-20">
          <div className="inline-block">
            <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block animate-[fadeIn_0.6s_ease-out]">
              Nasz Zespół
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6 animate-[fadeIn_0.8s_ease-out]">
              Poznaj Ludzi za Sukcesem
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto animate-[scaleIn_1s_ease-out]"></div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-[#d3bb73] text-lg">Ładowanie zespołu...</div>
          </div>
        ) : teamMembers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#e5e4e2]/60">Brak członków zespołu do wyświetlenia</p>
          </div>
        ) : (
            {teamMembers.map((member, index) => (
            <div
              key={member.id}
              className="group relative"
              style={{
                animation: `fadeInUp 0.6s ease-out ${index * 0.15}s both`,
              }}
              onMouseEnter={() => setHoveredId(member.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="relative overflow-hidden rounded-2xl">
                <div className="aspect-[3/4] relative overflow-hidden bg-[#800020]/10">
                  <img
                    src={member.image || 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=800'}
                    alt={member.alt || member.name}
                    className="transition-all duration-700"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (target.src !== 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=800') {
                        target.src = 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=800';
                      }
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
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

                  <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/40 to-transparent opacity-60 group-hover:opacity-90 transition-all duration-500"></div>

                  <div
                    className={`absolute top-4 right-4 flex gap-2 transition-all duration-500 ${
                      hoveredId === member.id
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 -translate-y-4'
                    }`}
                  >
                    <button className="w-10 h-10 rounded-full bg-[#d3bb73] backdrop-blur-sm flex items-center justify-center hover:bg-[#d3bb73]/80 transition-all duration-300 hover:scale-110 hover:rotate-12">
                      <Linkedin className="w-5 h-5 text-[#1c1f33]" />
                    </button>
                    <button className="w-10 h-10 rounded-full bg-[#d3bb73] backdrop-blur-sm flex items-center justify-center hover:bg-[#d3bb73]/80 transition-all duration-300 hover:scale-110 hover:rotate-12">
                      <Mail className="w-5 h-5 text-[#1c1f33]" />
                    </button>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-6 transform transition-all duration-500">
                    <h3 className="text-xl md:text-2xl font-light text-[#e5e4e2] mb-1 group-hover:text-[#d3bb73] transition-colors duration-300">
                      {member.name}
                    </h3>
                    <p className="text-[#d3bb73] text-sm font-light mb-3 tracking-wide">
                      {member.position || member.role}
                    </p>
                    <p
                      className={`text-[#e5e4e2]/80 text-sm font-light leading-relaxed transition-all duration-500 ${
                        hoveredId === member.id
                          ? 'opacity-100 translate-y-0 max-h-20'
                          : 'opacity-0 translate-y-4 max-h-0 overflow-hidden'
                      }`}
                    >
                      {member.bio}
                    </p>
                  </div>

                  <div className="absolute inset-0 border-2 border-transparent group-hover:border-[#d3bb73]/30 rounded-2xl transition-all duration-500 pointer-events-none"></div>
                </div>
              </div>

              <div className="absolute -inset-1 bg-gradient-to-br from-[#d3bb73]/0 via-[#d3bb73]/0 to-[#d3bb73]/0 group-hover:from-[#d3bb73]/20 group-hover:via-[#d3bb73]/5 group-hover:to-[#d3bb73]/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700 -z-10"></div>
            </div>
          ))}
          </div>
        )}

        <div className="text-center mt-16 animate-[fadeIn_1.2s_ease-out]">
          <p className="text-[#e5e4e2]/70 text-base md:text-lg font-light mb-6 max-w-2xl mx-auto">
            Nasz zespół to połączenie doświadczenia, kreatywności i pasji do tworzenia wyjątkowych wydarzeń
          </p>
          <button className="inline-flex items-center gap-2 px-8 py-4 bg-transparent border-2 border-[#d3bb73] text-[#d3bb73] rounded-full font-light hover:bg-[#d3bb73] hover:text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/30">
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
    </section>
  );
}
