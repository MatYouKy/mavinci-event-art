export interface IImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

export interface IUploadSettings {
  quality?: number;
  format?: string;
}

export interface IScreenMetadata {
  src?: string; // src bywa undefined zanim uploadniesz
  position?: IImagePosition;
  objectFit?: string;
  upload_settings?: IUploadSettings;
}

/** Metadata używane przy edycji (zawsze ma objectFit) */
export interface IScreenMetadataUpload {
  src?: string;
  objectFit: string; // ✅ tylko raz
  position?: IImagePosition;
  upload_settings?: IUploadSettings;
}

export interface IImageMetadata {
  desktop?: IScreenMetadata;
  mobile?: IScreenMetadata;
}

export interface IImageMetadataUpload {
  desktop?: IScreenMetadataUpload;
  mobile?: IScreenMetadataUpload;
}

export interface IImage {
  id?: string;
  alt?: string;
  image_metadata?: IImageMetadata;
}

/**
 * To jest obiekt, którym karmisz ImageEditorField / AvatarEditorModal:
 * { alt, image_metadata: { desktop:{...}, mobile:{...} } }
 */
export interface IUploadImage {
  alt?: string;
  image_metadata?: IImageMetadataUpload;
}