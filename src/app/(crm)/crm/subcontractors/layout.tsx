import PermissionGuard from '@/components/crm/PermissionGuard';
export default function SubcontractorsLayout({children}:{children:React.ReactNode}) {
  return <PermissionGuard module="contacts">{children}</PermissionGuard>;
}
