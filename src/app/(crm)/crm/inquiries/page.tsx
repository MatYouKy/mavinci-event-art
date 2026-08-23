import InquiriesPageClient from './InquiriesPageClient';
import {
  fetchInquiriesServer,
  fetchInquiryEmployeesServer,
} from '@/lib/CRM/inquiries/inquiriesData.server';

export default async function InquiriesPage() {
  const [inquiries, employees] = await Promise.all([
    fetchInquiriesServer(),
    fetchInquiryEmployeesServer(),
  ]);
  return <InquiriesPageClient initialInquiries={inquiries} employees={employees} />;
}
