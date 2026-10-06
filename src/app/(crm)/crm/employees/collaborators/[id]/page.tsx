import PersonnelPeople from '@/components/crm/personnel/PersonnelPeople';
export default function Page({ params }: { params: { id: string } }) { return <PersonnelPeople personId={params.id} />; }
