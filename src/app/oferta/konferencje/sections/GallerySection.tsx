import ConferencesGalleryEditor from './ConferencesGalleryEditor';
import React, { FC } from 'react';

interface GallerySectionProps {
  isEditMode: boolean;
  gallery: any[];
  loadData: () => void;
}

export const GallerySection: FC<GallerySectionProps> = ({ isEditMode, gallery, loadData }) => {
  return <ConferencesGalleryEditor />;
}
