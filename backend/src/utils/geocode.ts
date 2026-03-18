import axios from 'axios';

const apiKey = process.env.GOOGLE_PLACES_API_KEY;

export interface GeocodeResult {
  city: string | null;
  country: string | null;
  formattedAddress: string | null;
}

/**
 * Reverse geocode lat/lng to get city and country.
 * Uses Google Geocoding API address_components.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult> {
  if (!apiKey) {
    return { city: null, country: null, formattedAddress: null };
  }
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { latlng: `${latitude},${longitude}`, key: apiKey },
    });
    if (res.data?.status !== 'OK' || !res.data?.results?.[0]) {
      return { city: null, country: null, formattedAddress: null };
    }
    const result = res.data.results[0];
    const components = result.address_components || [];
    let city: string | null = null;
    let country: string | null = null;
    for (const c of components) {
      if (c.types?.includes('locality')) city = c.long_name;
      else if (!city && c.types?.includes('administrative_area_level_2')) city = c.long_name;
      else if (!city && c.types?.includes('administrative_area_level_1')) city = c.long_name;
      if (c.types?.includes('country')) country = c.long_name;
    }
    return {
      city: city || null,
      country: country || null,
      formattedAddress: result.formatted_address || null,
    };
  } catch (e) {
    console.error('[geocode] reverseGeocode error:', e);
    return { city: null, country: null, formattedAddress: null };
  }
}

/** City name -> IANA timezone for "midnight local" rotation */
const CITY_TIMEZONE: Record<string, string> = {
  singapore: 'Asia/Singapore',
  london: 'Europe/London',
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  tokyo: 'Asia/Tokyo',
  'hong kong': 'Asia/Hong_Kong',
  sydney: 'Australia/Sydney',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  'san francisco': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  chicago: 'America/Chicago',
  toronto: 'America/Toronto',
  melbourne: 'Australia/Melbourne',
  bangkok: 'Asia/Bangkok',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  jakarta: 'Asia/Jakarta',
  manila: 'Asia/Manila',
  taipei: 'Asia/Taipei',
  seoul: 'Asia/Seoul',
  mumbai: 'Asia/Kolkata',
  dubai: 'Asia/Dubai',
};

export function getTimezoneForCity(city: string): string {
  const normalized = city.toLowerCase().trim();
  return CITY_TIMEZONE[normalized] ?? 'UTC';
}
