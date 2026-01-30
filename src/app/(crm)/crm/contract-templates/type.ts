export interface IContractTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  content_html?: string;
  page_settings?: any;
  is_active: boolean;
  created_at: string;
}