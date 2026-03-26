import React, { memo } from 'react';
import { EmployeeInfoRow } from './EmployeeInfoRow';
    
interface EmployeeWebsiteVisibilityCardProps {
  employee: any;
  editedData: any;
  setEditedData: React.Dispatch<React.SetStateAction<any>>;
  isEditing: boolean; 
}

function EmployeeWebsiteVisibilityCardComponent({
  employee,
  editedData,
  setEditedData,
  isEditing,
}: EmployeeWebsiteVisibilityCardProps) {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Widoczność na stronie</h3>

      {isEditing ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="show_on_website"
              checked={editedData.show_on_website || false}
              onChange={(e) =>
                setEditedData((prev: any) => ({
                  ...prev,
                  show_on_website: e.target.checked,
                }))
              }
              className="h-5 w-5 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
            />
            <label htmlFor="show_on_website" className="text-[#e5e4e2]">
              Wyświetl na stronie /zespół
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[#e5e4e2]/60">
              Kolejność wyświetlania (0 = pierwszy)
            </label>
            <input
              type="number"
              min="0"
              value={editedData.order_index ?? 999}
              onChange={(e) =>
                setEditedData((prev: any) => ({
                  ...prev,
                  order_index: parseInt(e.target.value, 10) || 0,
                }))
              }
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              placeholder="0"
            />
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              Niższa liczba = wyżej na liście. Admini mają automatycznie 0.
            </p>
          </div>

          {editedData.show_on_website && (
            <>
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">
                  Biografia (dla strony)
                </label>
                <textarea
                  value={editedData.website_bio || ''}
                  onChange={(e) =>
                    setEditedData((prev: any) => ({
                      ...prev,
                      website_bio: e.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                  placeholder="Krótki opis do wyświetlenia na stronie..."
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">LinkedIn URL</label>
                  <input
                    type="url"
                    value={editedData.linkedin_url || ''}
                    onChange={(e) =>
                      setEditedData((prev: any) => ({
                        ...prev,
                        linkedin_url: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    placeholder="https://linkedin.com/in/..."
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Instagram URL</label>
                  <input
                    type="url"
                    value={editedData.instagram_url || ''}
                    onChange={(e) =>
                      setEditedData((prev: any) => ({
                        ...prev,
                        instagram_url: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    placeholder="https://instagram.com/..."
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Facebook URL</label>
                  <input
                    type="url"
                    value={editedData.facebook_url || ''}
                    onChange={(e) =>
                      setEditedData((prev: any) => ({
                        ...prev,
                        facebook_url: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    placeholder="https://facebook.com/..."
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <EmployeeInfoRow
            label="Status"
            value={employee.show_on_website ? '✓ Widoczny na stronie' : '✗ Ukryty'}
          />

          <EmployeeInfoRow
            label="Kolejność"
            value={`${employee.order_index ?? 999}${
              employee.order_index === 0 ? ' (pierwszy)' : ''
            }`}
          />

          {employee.show_on_website && (
            <>
              {employee.website_bio && (
                <div>
                  <p className="mb-1 text-xs text-[#e5e4e2]/60">Biografia</p>
                  <p className="text-[#e5e4e2]">{employee.website_bio}</p>
                </div>
              )}

              {employee.linkedin_url && (
                <EmployeeInfoRow label="LinkedIn" value={employee.linkedin_url} />
              )}

              {employee.instagram_url && (
                <EmployeeInfoRow label="Instagram" value={employee.instagram_url} />
              )}

              {employee.facebook_url && (
                <EmployeeInfoRow label="Facebook" value={employee.facebook_url} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(EmployeeWebsiteVisibilityCardComponent);