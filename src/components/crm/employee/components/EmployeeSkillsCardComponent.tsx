import React, { memo } from 'react';

function EmployeeSkillsCardComponent({ skills }: { skills: string[] }) {
  if (!skills?.length) return null;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Umiejętności</h3>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill, idx) => (
          <span
            key={`${skill}-${idx}`}
            className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-sm text-[#d3bb73]"
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(EmployeeSkillsCardComponent);