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
}

export interface IScreenMetadataUpload {
  objectFit: string;
  objectFit: string;
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
  mobile: { src: string; position: { posX: number; posY: number; scale: number; }; };
  desktop: { src: string; position: { posX: number; posY: number; scale: number; }; };
  file?: File;
  alt?: string;
  image_metadata?: IImageMetadataUpload;
}
