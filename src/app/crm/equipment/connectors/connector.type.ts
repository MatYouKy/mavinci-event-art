export type ConnectorDirectioType = 'input' | 'output' | 'bidirectional' | 'unknown';

export type ConnectorCategoryType = 'signal' | 'video' | 'web' | 'power' | 'other';

export interface IConnectorType {
  _id: string;
  direction: ConnectorDirectioType;
  category: ConnectorCategoryType;
  name: string;
  description: string | null;
  common_uses: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
  thumbnail?: File | null;
}

export type CreateConnectorBody = Omit<IConnectorType, '_id' | 'thumbnail_url' | 'created_at' | 'updated_at'> & {
  // thumbnail ustawiamy przez FormData (pole 'thumbnail')
  thumbnail?: File | null;
};

export type UpdateConnectorBody = Partial<CreateConnectorBody>;


export interface FormValues extends Omit<IConnectorType, '_id' | 'thumbnail_url' | 'created_at' | 'updated_at'> {
  name: string;
  description: string;
  common_uses: string;
  is_active: boolean;
  direction: ConnectorDirectioType;
  category: ConnectorCategoryType;
};

export const ConnectorCategoryOptions: { value: ConnectorCategoryType; label: string }[] = [
  { value: 'signal', label: 'Sygnałowy' },
  { value: 'video', label: 'Wideo' },
  { value: 'web', label: 'Sieciowy' },
  { value: 'power', label: 'Zasilania' },
  { value: 'other', label: 'Inny' },
];