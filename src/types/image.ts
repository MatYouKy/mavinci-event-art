export type ImageObjectFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

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
  src?: string;
  position?: IImagePosition;
  objectFit?: ImageObjectFit;
  upload_settings?: IUploadSettings;
}

export interface IScreenMetadataUpload {
  src?: string;
  objectFit: ImageObjectFit;
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

export interface IUploadImage {
  file?: File;
  fileUrl?: string;
  fileFolder?: string;
  alt?: string;
  image_metadata?: IImageMetadataUpload;
}