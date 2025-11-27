import React, { FC } from 'react';
import { iconMap } from '../ConferencesPage';
import { Settings } from 'lucide-react';

interface ProblemAndSolutionProps {
  problems: any[];
}

export const ProblemAndSolution:FC<ProblemAndSolutionProps> = ({ problems,  }) => {
  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Settings;
    return Icon;
  };
  return (
    <section className="py-20 px-6 bg-[#1c1f33]/30">
    <div className="max-w-7xl mx-auto">
      <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
        Najczęstsze problemy organizatorów konferencji
      </h2>
      <p className="text-[#e5e4e2]/60 text-center mb-16 max-w-2xl mx-auto">
        I nasze profesjonalne rozwiązania
      </p>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {problems.map((problem) => {
          const Icon = getIcon(problem.icon_name);
          return (
            <div key={problem.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 hover:border-[#d3bb73]/40 transition-all">
              <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center mb-4">
                <Icon className="w-6 h-6 text-[#d3bb73]" />
              </div>
              <h3 className="text-xl font-medium text-[#e5e4e2] mb-3">
                {problem.title}
              </h3>
              <p className="text-[#e5e4e2]/60 mb-4 text-sm">
                <span className="text-red-400">Problem:</span> {problem.problem_description}
              </p>
              <p className="text-[#e5e4e2]/80 text-sm">
                <span className="text-[#d3bb73]">Rozwiązanie:</span> {problem.solution_description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  </section>
  )
}
