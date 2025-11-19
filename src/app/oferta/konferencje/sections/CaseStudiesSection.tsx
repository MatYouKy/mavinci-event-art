import React, { FC } from 'react';
import { Users } from 'lucide-react';
interface CaseStudiesSectionProps {
  caseStudies: any[];
}

export const CaseStudiesSection:FC<CaseStudiesSectionProps> = ({ caseStudies }) => {
  return (
    <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto" style={{ display: 'none' }}>
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Case Studies (Hidden)
            </h2>

            <div className="space-y-12">
              {caseStudies.map((study) => (
                <div key={study.id} className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-8">
                  <div className="grid md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-2xl font-medium text-[#e5e4e2] mb-2">
                        {study.project_name}
                      </h3>
                      {study.client_name && (
                        <p className="text-[#d3bb73] mb-4">{study.client_name}</p>
                      )}
                      <p className="text-[#e5e4e2]/60 mb-6">{study.event_type}</p>

                      {study.attendees_count && (
                        <div className="flex items-center gap-2 text-[#e5e4e2]/80 mb-4">
                          <Users className="w-5 h-5 text-[#d3bb73]" />
                          <span>{study.attendees_count} uczestników</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Wyzwanie</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.challenge}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Rozwiązanie</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.solution}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Rezultat</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.result}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Wykorzystany sprzęt</h4>
                        <div className="flex flex-wrap gap-2">
                          {study.equipment_used.map((eq: string, idx: number) => (
                            <span key={idx} className="text-xs px-3 py-1 bg-[#d3bb73]/10 text-[#e5e4e2]/80 rounded-full">
                              {eq}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
  )
}
