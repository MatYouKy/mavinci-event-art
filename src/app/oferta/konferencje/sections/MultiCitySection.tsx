import { Edit2, MapPin, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import React, { FC } from 'react';
interface MultiCitySectionProps {
  cities: any[];
  editingCity: any;
  isEditMode: boolean;
  isEditingCities: boolean;
  newCityName: string;
  isAddingCity: boolean;
  setIsEditingCities: (isEditing: boolean) => void;
  handleUpdateCity: (city: any) => void;
  setEditingCity: (city: any) => void;
  setIsAddingCity: (isAdding: boolean) => void;
  handleDeleteCity: (id: string) => void;
  setNewCityName: (name: string) => void;
  handleAddCity: () => void;
}

export const MultiCitySection:FC<MultiCitySectionProps> = ({ isEditMode, isEditingCities, setIsEditingCities, handleUpdateCity, setEditingCity, setIsAddingCity, handleDeleteCity, cities, editingCity, newCityName, setNewCityName, handleAddCity, isAddingCity }) => {
  
  return (
    <section className="py-16 px-6 border-t border-[#1c1f33]">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-4 mb-3">
                  <p className="text-[#e5e4e2]/40 text-sm">Obsługujemy konferencje w miastach:</p>
                  {isEditMode && !isEditingCities && (
                    <button
                      onClick={() => setIsEditingCities(true)}
                      className="px-3 py-1 bg-[#d3bb73] text-[#1c1f33] rounded text-xs hover:bg-[#d3bb73]/90"
                    >
                      Edytuj miasta
                    </button>
                  )}
                  {isEditMode && isEditingCities && (
                    <button
                      onClick={() => {
                        setIsEditingCities(false);
                        setEditingCity(null);
                        setIsAddingCity(false);
                      }}
                      className="px-3 py-1 bg-[#800020] text-[#e5e4e2] rounded text-xs hover:bg-[#800020]/90"
                    >
                      Zamknij edycję
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
                  {cities.map((city) => {
                    const isEditing = editingCity?.id === city.id;
                    return isEditing ? (
                      <div key={city.id} className="inline-flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-1">
                        <input
                          type="text"
                          value={editingCity.city_name}
                          onChange={(e) => setEditingCity({ ...editingCity, city_name: e.target.value })}
                          className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-0.5 text-[#e5e4e2] text-sm w-32 outline-none focus:border-[#d3bb73]"
                        />
                        <button
                          onClick={() => handleUpdateCity(editingCity)}
                          className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-xs"
                        >
                          Zapisz
                        </button>
                        <button
                          onClick={() => setEditingCity(null)}
                          className="text-[#800020] hover:text-[#800020]/80 text-xs"
                        >
                          Anuluj
                        </button>
                      </div>
                    ) : (
                      <div key={city.id} className="inline-flex items-center gap-2">
                        <Link
                          href={`/oferta/konferencje/${city.slug}`}
                          className="text-[#e5e4e2]/60 hover:text-[#d3bb73] transition-colors text-sm"
                        >
                          {city.city_name}
                        </Link>
                        {isEditMode && isEditingCities && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => setEditingCity(city)}
                              className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteCity(city.id)}
                              className="text-[#800020] hover:text-[#800020]/80"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {isEditMode && isEditingCities && (
                    <>
                      {isAddingCity ? (
                        <div className="inline-flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-1">
                          <input
                            type="text"
                            value={newCityName}
                            onChange={(e) => setNewCityName(e.target.value)}
                            placeholder="Nazwa miasta"
                            className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-0.5 text-[#e5e4e2] text-sm w-32 outline-none focus:border-[#d3bb73]"
                          />
                          <button
                            onClick={handleAddCity}
                            className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-xs"
                          >
                            Dodaj
                          </button>
                          <button
                            onClick={() => {
                              setIsAddingCity(false);
                              setNewCityName('');
                            }}
                            className="text-[#800020] hover:text-[#800020]/80 text-xs"
                          >
                            Anuluj
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setIsAddingCity(true)}
                          className="inline-flex items-center gap-1 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Dodaj miasto
                        </button>
                      )}
                    </>
                  )}
                </div>

                {isEditMode && <div className="text-center mt-8">
                  <Link
                    href="/oferta/konferencje/lokalizacje"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#d3bb73]/20 text-[#d3bb73] rounded hover:bg-[#d3bb73]/30 transition-colors border border-[#d3bb73]/20"
                  >
                    <MapPin className="w-4 h-4" />
                    Zobacz wszystkie lokalizacje
                  </Link>
                </div>}
              </div>
            </div>
          </section>
  )
}
