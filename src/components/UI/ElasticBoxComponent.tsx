import React from 'react';

interface ElasticBoxComponentProps {
  children: React.ReactNode;
  mode?: 'vertical' | 'horizontal';
  multiplier?: number;
  style?: React.CSSProperties;
}

export const ElasticBoxComponent: React.FC<ElasticBoxComponentProps> = ({
  children,
  mode = 'vertical',
  multiplier = 1,
  style,
}) => {
  const aspectRatio = mode === 'vertical' ? `${1 * multiplier}/${1}` : `${1}/${1 * multiplier}`;

  // Jeśli style zawiera position: absolute i inset, nie używamy aspectRatio
  const hasAbsolutePositioning = style && 'position' in style && style.position === 'absolute';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        ...(hasAbsolutePositioning ? {} : { aspectRatio }),
        ...style,
      }}
    >
      {children}
    </div>
  );
};
