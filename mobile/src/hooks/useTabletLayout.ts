import { useWindowDimensions } from 'react-native';

/*
 * Tablet w poziomie (jak CRM na komputerze): menu boczne zawsze widoczne obok treści; w pionie i na telefonie — menu „burger”.
 * Tablet — krótszy bok co najmniej 600 punktów; pasek boczny — w poziomie, gdy okno ma co najmniej 900 punktów szerokości
 * (podział ekranu na iPadzie z wąskim oknem wraca do menu „burger”). Ekrany, które liczą układ z szerokości okna, biorą
 * szerokość treści (`useContentWidth`) — bez paska bocznego.
 */

export const TABLET_SIDEBAR_WIDTH = 280;

export function useTabletLayout() {
  const { width, height } = useWindowDimensions();
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  return { tablet, landscape, sidebar: tablet && landscape && width >= 900 };
}

/** Szerokość obszaru treści: okno bez stałego paska bocznego (tablet w poziomie). */
export function useContentWidth() {
  const { width } = useWindowDimensions();
  const { sidebar } = useTabletLayout();
  return sidebar ? width - TABLET_SIDEBAR_WIDTH : width;
}
