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
  file?: File;
  is_main?: boolean;
  order?: number;
}

export interface IUploadImage {
  file?: File;
  alt?: string;
  image_metadata?: IImageMetadataUpload;
  is_main?: boolean;
  order?: number;
}

export interface ISingleImage {
  order?: number;
  is_main?: boolean;
  src: string;
  alt: string;
}


export type FormGalleryItem = ISingleImage & {
  file?: File | null;
  preview_url?: string | null;
  _tempId?: string;
};
