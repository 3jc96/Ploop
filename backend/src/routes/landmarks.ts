import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import axios from 'axios';
import pool from '../config/database';

const router = Router();

// Search landmarks using Google Places API
router.get(
  '/search',
  [
    query('query').optional().isString().trim(),
    query('latitude').optional().isFloat({ min: -90, max: 90 }),
    query('longitude').optional().isFloat({ min: -180, max: 180 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { query: searchQuery, latitude, longitude } = req.query as any;
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;

      // If no query but latitude/longitude provided, do nearby search
      if (!searchQuery && latitude && longitude) {
        if (!apiKey) {
          // Return nearby preset landmarks
          return res.json({
            landmarks: getPresetLandmarks('').slice(0, 10),
          });
        }

        try {
          const response = await axios.get(
            'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
            {
              params: {
                location: `${latitude},${longitude}`,
                radius: 1000, // 1km radius
                key: apiKey,
                type: 'establishment',
              },
            }
          );

          const status = response.data?.status;
          const results = status === 'OK' ? (response.data.results || []) : [];
          const landmarks = results.map((place: any) => ({
            id: place.place_id,
            name: place.name,
            address: place.vicinity || place.formatted_address || '',
            latitude: place.geometry.location.lat,
            longitude: place.geometry.location.lng,
            types: place.types,
          }));

          return res.json({ landmarks });
        } catch (apiError: any) {
          console.error('Google Places API error:', apiError.message);
          return res.json({
            landmarks: getPresetLandmarks('').slice(0, 10),
          });
        }
      }

      if (!apiKey) {
        // Return preset landmarks if no API key
        return res.json({
          landmarks: getPresetLandmarks(searchQuery || ''),
        });
      }

      try {
        // Use Google Places API Text Search first
        const response = await axios.get(
          'https://maps.googleapis.com/maps/api/place/textsearch/json',
          {
            params: {
              query: searchQuery,
              key: apiKey,
              ...(latitude && longitude && {
                location: `${latitude},${longitude}`,
                radius: 50000, // 50km radius
              }),
            },
          }
        );

        const status = response.data?.status;
        if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
          console.error('Google Places API status:', status, response.data?.error_message);
          return res.json({ landmarks: getPresetLandmarks(searchQuery as string) });
        }
        let results = response.data?.results || [];

        // If Text Search returns nothing, try Find Place from Text (better for partial names like "julio cesar")
        if (results.length === 0) {
          const findParams: Record<string, string> = {
            input: searchQuery,
            inputtype: 'textquery',
            fields: 'place_id,name,formatted_address,geometry',
            key: apiKey,
          };
          if (latitude && longitude) {
            findParams.locationbias = `circle:50000@${latitude},${longitude}`;
          }
          const findResponse = await axios.get(
            'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
            { params: findParams }
          );
          const candidates = findResponse.data.candidates || [];
          results = candidates.map((c: any) => ({
            place_id: c.place_id,
            name: c.name || '',
            formatted_address: c.formatted_address || '',
            geometry: c.geometry || { location: { lat: 0, lng: 0 } },
            types: [],
          }));
        }

        const landmarks = results.map((place: any) => ({
          id: place.place_id,
          name: place.name,
          address: place.formatted_address,
          latitude: place.geometry?.location?.lat ?? 0,
          longitude: place.geometry?.location?.lng ?? 0,
          types: place.types || [],
        }));

        res.json({ landmarks });
      } catch (apiError: any) {
        console.error('Google Places API error:', apiError.message);
        // Fallback to preset landmarks on API error
        res.json({
          landmarks: getPresetLandmarks(searchQuery as string),
        });
      }
    } catch (error) {
      console.error('Error searching landmarks:', error);
      // Return 200 with fallback so the app doesn't break; log for debugging
      res.json({ landmarks: getPresetLandmarks((req.query as any).query || '') });
    }
  }
);

// Get landmark details and Google reviews by place ID
router.get(
  '/:placeId',
  [query('placeId').isString().notEmpty()],
  async (req: Request, res: Response) => {
    try {
      const { placeId } = req.params;
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: 'Google Places API key not configured' });
      }

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/details/json`,
        {
          params: {
            place_id: placeId,
            key: apiKey,
            fields: 'name,formatted_address,geometry,place_id,rating,user_ratings_total,reviews,photos,opening_hours',
          },
        }
      );

      if (response.data.status !== 'OK') {
        return res.status(404).json({
          error: 'Landmark not found',
          status: response.data.status,
          message: response.data.error_message,
        });
      }

      const place = response.data.result;
      res.json({
        id: place.place_id,
        name: place.name,
        address: place.formatted_address,
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng,
        googleRating: place.rating,
        googleReviewCount: place.user_ratings_total,
        openNow: place.opening_hours?.open_now,
        weekdayText: place.opening_hours?.weekday_text || [],
        googleReviews: place.reviews ? place.reviews.map((review: any) => ({
          author: review.author_name,
          rating: review.rating,
          text: review.text,
          time: review.time,
          relativeTime: review.relative_time_description,
        })) : [],
      });
    } catch (error) {
      console.error('Error fetching landmark details:', error);
      res.status(500).json({ error: 'Failed to fetch landmark details' });
    }
  }
);

// Get location details by coordinates (reverse geocoding + nearby search)
router.get(
  '/location/details',
  [
    query('latitude').isFloat({ min: -90, max: 90 }),
    query('longitude').isFloat({ min: -180, max: 180 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { latitude, longitude } = req.query as any;
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;

      let address = `Location at ${latitude}, ${longitude}`;
      
      // Always try reverse geocoding to get address (works with or without API key for basic geocoding)
      if (apiKey) {
        try {
          const geocodeResponse = await axios.get(
            'https://maps.googleapis.com/maps/api/geocode/json',
            {
              params: {
                latlng: `${latitude},${longitude}`,
                key: apiKey,
              },
            }
          );

          if (geocodeResponse.data.results && geocodeResponse.data.results.length > 0) {
            address = geocodeResponse.data.results[0].formatted_address;
          }
        } catch (geocodeError) {
          console.error('Reverse geocoding error:', geocodeError);
        }
      }

      if (!apiKey) {
        // Without API key, return address from reverse geocoding (if available) or coordinates
        return res.json({
          location: {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            address: address,
          },
        });
      }

      try {
        // Helper function to calculate distance in meters using Haversine formula
        const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
          const R = 6371000; // Earth radius in meters
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };

        const tappedLat = parseFloat(latitude);
        const tappedLng = parseFloat(longitude);
        let placeDetails = null;

        // Use larger radius (50m) to catch more POIs, then filter by precise distance
        // Google Maps uses approximately 30-50m clickable area for POIs
        // This approach: cast wider net → filter precisely → get best match
        const nearbyResponse = await axios.get(
          'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
          {
            params: {
              location: `${latitude},${longitude}`,
              radius: 50, // 50m radius - matches Google Maps POI clickable area
              key: apiKey,
            },
          }
        );

        if (nearbyResponse.data.results && nearbyResponse.data.results.length > 0) {
          // Calculate precise distance for each result using Haversine formula
          const resultsWithDistance = nearbyResponse.data.results.map((place: any) => ({
            ...place,
            distance: calculateDistance(
              tappedLat,
              tappedLng,
              place.geometry.location.lat,
              place.geometry.location.lng
            ),
          }));

          // Sort by distance (closest first)
          resultsWithDistance.sort((a: any, b: any) => a.distance - b.distance);
          
          // Filter to places within 30m (typical Google Maps POI clickable area)
          // This ensures we only select POIs that the user likely intended to tap
          const closeResults = resultsWithDistance.filter((r: any) => r.distance <= 30);
          const nearestPlace = closeResults.length > 0 ? closeResults[0] : resultsWithDistance[0];
          
          // Get detailed info including reviews (parallel request for speed)
          try {
            const detailsResponse = await axios.get(
              'https://maps.googleapis.com/maps/api/place/details/json',
              {
                params: {
                  place_id: nearestPlace.place_id,
                  key: apiKey,
                  fields: 'name,formatted_address,rating,user_ratings_total,reviews,place_id,geometry',
                },
              }
            );

            if (detailsResponse.data.status === 'OK') {
              const place = detailsResponse.data.result;
              placeDetails = {
                placeId: place.place_id,
                name: place.name,
                address: place.formatted_address,
                googleRating: place.rating,
                googleReviewCount: place.user_ratings_total,
                googleReviews: place.reviews ? place.reviews.slice(0, 5).map((review: any) => ({
                  author: review.author_name,
                  rating: review.rating,
                  text: review.text,
                  time: review.time,
                  relativeTime: review.relative_time_description,
                })) : [],
              };
            } else {
              // If details API fails, use nearby search data as fallback
              placeDetails = {
                placeId: nearestPlace.place_id,
                name: nearestPlace.name,
                address: nearestPlace.vicinity || nearestPlace.formatted_address || address,
                googleRating: nearestPlace.rating,
                googleReviewCount: nearestPlace.user_ratings_total,
                googleReviews: [],
              };
            }
          } catch (detailsError) {
            // Fallback to nearby search data if details API fails
            placeDetails = {
              placeId: nearestPlace.place_id,
              name: nearestPlace.name,
              address: nearestPlace.vicinity || nearestPlace.formatted_address || address,
              googleRating: nearestPlace.rating,
              googleReviewCount: nearestPlace.user_ratings_total,
              googleReviews: [],
            };
          }
        }

        res.json({
          location: {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            address,
          },
          place: placeDetails,
        });
      } catch (apiError: any) {
        console.error('Google Places API error:', apiError.message);
        res.json({
          location: {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            address: `Location at ${latitude}, ${longitude}`,
          },
        });
      }
    } catch (error) {
      console.error('Error fetching location details:', error);
      res.status(500).json({ error: 'Failed to fetch location details' });
    }
  }
);

// Preset landmarks (fallback when no API key)
function getPresetLandmarks(query: string): Array<{
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  types: string[];
}> {
  const lowerQuery = query.toLowerCase().trim();
  
  // Extended preset landmarks list
  const presets = [
    // Airports
    {
      id: 'preset-changi-t1',
      name: 'Changi Airport Terminal 1',
      address: 'Singapore Changi Airport, Terminal 1, Singapore',
      latitude: 1.3644,
      longitude: 103.9915,
      types: ['airport', 'establishment'],
    },
    {
      id: 'preset-changi-t2',
      name: 'Changi Airport Terminal 2',
      address: 'Singapore Changi Airport, Terminal 2, Singapore',
      latitude: 1.3576,
      longitude: 103.9891,
      types: ['airport', 'establishment'],
    },
    {
      id: 'preset-changi-t3',
      name: 'Changi Airport Terminal 3',
      address: 'Singapore Changi Airport, Terminal 3, Singapore',
      latitude: 1.3568,
      longitude: 103.9884,
      types: ['airport', 'establishment'],
    },
    {
      id: 'preset-changi-t4',
      name: 'Changi Airport Terminal 4',
      address: 'Singapore Changi Airport, Terminal 4, Singapore',
      latitude: 1.3605,
      longitude: 103.9922,
      types: ['airport', 'establishment'],
    },
    // Shopping Malls
    {
      id: 'preset-marina-bay',
      name: 'Marina Bay Sands',
      address: '10 Bayfront Ave, Singapore',
      latitude: 1.2834,
      longitude: 103.8608,
      types: ['lodging', 'establishment', 'shopping_mall'],
    },
    {
      id: 'preset-orchard-road',
      name: 'Orchard Road',
      address: 'Orchard Road, Singapore',
      latitude: 1.3048,
      longitude: 103.8318,
      types: ['route', 'establishment'],
    },
    {
      id: 'preset-iona-orchard',
      name: 'Ion Orchard',
      address: '2 Orchard Turn, Singapore',
      latitude: 1.3046,
      longitude: 103.8314,
      types: ['shopping_mall', 'establishment'],
    },
    {
      id: 'preset-ngee-ann',
      name: 'Ngee Ann City',
      address: '391 Orchard Rd, Singapore',
      latitude: 1.3036,
      longitude: 103.8330,
      types: ['shopping_mall', 'establishment'],
    },
    {
      id: 'preset-vivo-city',
      name: 'VivoCity',
      address: '1 HarbourFront Walk, Singapore',
      latitude: 1.2643,
      longitude: 103.8222,
      types: ['shopping_mall', 'establishment'],
    },
    {
      id: 'preset-jem',
      name: 'JEM',
      address: '50 Jurong Gateway Rd, Singapore',
      latitude: 1.3329,
      longitude: 103.7434,
      types: ['shopping_mall', 'establishment'],
    },
    {
      id: 'preset-westgate',
      name: 'Westgate',
      address: '3 Gateway Dr, Singapore',
      latitude: 1.3338,
      longitude: 103.7426,
      types: ['shopping_mall', 'establishment'],
    },
    // MRT Stations
    {
      id: 'preset-orchard-mrt',
      name: 'Orchard MRT Station',
      address: 'Orchard Rd, Singapore',
      latitude: 1.3046,
      longitude: 103.8324,
      types: ['transit_station', 'establishment'],
    },
    {
      id: 'preset-city-hall-mrt',
      name: 'City Hall MRT Station',
      address: '150 North Bridge Rd, Singapore',
      latitude: 1.2932,
      longitude: 103.8523,
      types: ['transit_station', 'establishment'],
    },
    {
      id: 'preset-raffles-place-mrt',
      name: 'Raffles Place MRT Station',
      address: 'Raffles Place, Singapore',
      latitude: 1.2839,
      longitude: 103.8514,
      types: ['transit_station', 'establishment'],
    },
    // Tourist Attractions
    {
      id: 'preset-gardens-by-bay',
      name: 'Gardens by the Bay',
      address: '18 Marina Gardens Dr, Singapore',
      latitude: 1.2816,
      longitude: 103.8636,
      types: ['tourist_attraction', 'establishment'],
    },
    {
      id: 'preset-sentosa',
      name: 'Sentosa Island',
      address: 'Sentosa Island, Singapore',
      latitude: 1.2494,
      longitude: 103.8303,
      types: ['tourist_attraction', 'establishment'],
    },
    {
      id: 'preset-merlion',
      name: 'Merlion Park',
      address: '1 Fullerton Rd, Singapore',
      latitude: 1.2868,
      longitude: 103.8545,
      types: ['tourist_attraction', 'establishment'],
    },
    {
      id: 'preset-singapore-zoo',
      name: 'Singapore Zoo',
      address: '80 Mandai Lake Rd, Singapore',
      latitude: 1.4043,
      longitude: 103.7930,
      types: ['zoo', 'tourist_attraction', 'establishment'],
    },
    // Hospitals
    {
      id: 'preset-nuh',
      name: 'National University Hospital',
      address: '5 Lower Kent Ridge Rd, Singapore',
      latitude: 1.2958,
      longitude: 103.7840,
      types: ['hospital', 'establishment'],
    },
    {
      id: 'preset-sgh',
      name: 'Singapore General Hospital',
      address: 'Outram Rd, Singapore',
      latitude: 1.2786,
      longitude: 103.8336,
      types: ['hospital', 'establishment'],
    },
    // Universities
    {
      id: 'preset-nus',
      name: 'National University of Singapore',
      address: '21 Lower Kent Ridge Rd, Singapore',
      latitude: 1.2966,
      longitude: 103.7764,
      types: ['university', 'establishment'],
    },
    {
      id: 'preset-ntu',
      name: 'Nanyang Technological University',
      address: '50 Nanyang Ave, Singapore',
      latitude: 1.3483,
      longitude: 103.6831,
      types: ['university', 'establishment'],
    },
  ];

  // If query is empty or very short, return all presets (limited)
  if (!lowerQuery || lowerQuery.length < 2) {
    return presets.slice(0, 20); // Return first 20 if no query
  }

  // Filter by query
  return presets.filter((landmark) =>
    landmark.name.toLowerCase().includes(lowerQuery) ||
    landmark.address.toLowerCase().includes(lowerQuery) ||
    landmark.types.some(type => type.includes(lowerQuery))
  );
}

export default router;
