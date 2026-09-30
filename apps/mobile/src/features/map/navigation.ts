import { Linking, Platform } from 'react-native';

/**
 * Fallback: Route in Apple Maps / Google Maps öffnen. Die Route in der App selbst
 * liegt in features/route (Bildschirm /route).
 */
export interface Destination {
  lat: number;
  lng: number;
  label?: string;
}

export interface NavigationService {
  openRoute(destination: Destination): Promise<void>;
}

const googleWebUrl = ({ lat, lng }: Destination) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

export const externalMapsNavigation: NavigationService = {
  async openRoute(destination) {
    const { lat, lng, label } = destination;
    const q = label ? encodeURIComponent(label) : '';
    const url = Platform.select({
      ios: `maps://?daddr=${lat},${lng}&dirflg=d${q ? `&q=${q}` : ''}`,
      android: `google.navigation:q=${lat},${lng}`,
      default: googleWebUrl(destination),
    });
    // Kein canOpenURL: das würde auf iOS einen Eintrag in LSApplicationQueriesSchemes verlangen.
    // Apple Maps ist immer installiert; schlägt das Öffnen fehl, greift der Web-Fallback.
    try {
      if (url) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Fallback unten
    }
    await Linking.openURL(googleWebUrl(destination));
  },
};

export const navigation: NavigationService = externalMapsNavigation;
