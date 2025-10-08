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
  src: string;
  position?: IImagePosition;
  upload_settings?: IUploadSettings;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
}

export interface IScreenMetadataUpload {
  position?: IImagePosition;
  upload_settings?: IUploadSettings;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
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
  alt?: string;
  image_metadata?: IImageMetadataUpload;
}
