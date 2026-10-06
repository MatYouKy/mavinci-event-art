import { redirect } from 'next/navigation';
export default function InvitationPage({ searchParams }: { searchParams: { token?: string } }) {
  redirect(`/invitation/accept?token=${encodeURIComponent(searchParams.token || '')}`);
}
