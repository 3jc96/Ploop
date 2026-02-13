import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import axios from 'axios';

const router = Router();

function getDirectionsApiKey(): string | undefined {
  return (
    process.env.GOOGLE_ROUTES_API_KEY ||
    process.env.GOOGLE_DIRECTIONS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY
  );
}

function travelModeFromQuery(mode: string): string {
  switch (mode) {
    case 'driving':
      return 'DRIVE';
    case 'walking':
      return 'WALK';
    case 'bicycling':
      return 'BICYCLE';
    default:
      return 'WALK';
  }
}

function formatDistance(distanceMeters?: number): string | undefined {
  if (typeof distanceMeters !== 'number' || Number.isNaN(distanceMeters)) return undefined;
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)} km`;
  return `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSeconds?: number): string | undefined {
  if (typeof durationSeconds !== 'number' || Number.isNaN(durationSeconds)) return undefined;
  const totalMinutes = Math.round(durationSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function parseDurationSeconds(raw?: string): number | undefined {
  if (typeof raw !== 'string') return undefined;
  // e.g. "123s" or "123.5s"
  if (!raw.endsWith('s')) return undefined;
  const n = Number(raw.slice(0, -1));
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function safeText(v: any): string | undefined {
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : undefined;
  }
  // Some localized values may come back as objects like { text: "..." }
  if (v && typeof v === 'object' && typeof (v as any).text === 'string') {
    const s = String((v as any).text).trim();
    return s ? s : undefined;
  }
  return undefined;
}

function computeWaitMinutes(departureTimeIso?: string): number | undefined {
  if (!departureTimeIso) return undefined;
  const t = Date.parse(departureTimeIso);
  if (!Number.isFinite(t)) return undefined;
  const diffMs = t - Date.now();
  if (diffMs < 0) return 0;
  return Math.round(diffMs / 60000);
}

router.get(
  '/',
  [
    query('originLat').isFloat({ min: -90, max: 90 }),
    query('originLng').isFloat({ min: -180, max: 180 }),
    query('destLat').isFloat({ min: -90, max: 90 }),
    query('destLng').isFloat({ min: -180, max: 180 }),
    query('mode').optional().isIn(['driving', 'walking', 'bicycling']),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const apiKey = getDirectionsApiKey();
    if (!apiKey) {
      return res.status(500).json({
        error:
          'Google Routes API key not configured. Set GOOGLE_ROUTES_API_KEY (or GOOGLE_DIRECTIONS_API_KEY / GOOGLE_MAPS_API_KEY / GOOGLE_PLACES_API_KEY).',
      });
    }

    const { originLat, originLng, destLat, destLng, mode = 'walking' } = req.query as any;
    try {
      // Use the newer Routes API (Directions API legacy may be disabled on some projects).
      const response = await axios.post(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          origin: {
            location: { latLng: { latitude: Number(originLat), longitude: Number(originLng) } },
          },
          destination: {
            location: { latLng: { latitude: Number(destLat), longitude: Number(destLng) } },
          },
          travelMode: travelModeFromQuery(String(mode)),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            // Request step-by-step breakdown (especially for TRANSIT).
            // Docs: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
            'X-Goog-FieldMask': [
              'routes.distanceMeters',
              'routes.duration',
              'routes.polyline.encodedPolyline',
              'routes.localizedValues.transitFare',
              'routes.legs.steps.travelMode',
              'routes.legs.steps.distanceMeters',
              'routes.legs.steps.staticDuration',
              'routes.legs.steps.localizedValues.distance',
              'routes.legs.steps.localizedValues.staticDuration',
              'routes.legs.steps.navigationInstruction.instructions',
              // Transit details (include parent + common subfields for reliability)
              'routes.legs.steps.transitDetails',
              'routes.legs.steps.transitDetails.headsign',
              'routes.legs.steps.transitDetails.headway',
              'routes.legs.steps.transitDetails.stopCount',
              'routes.legs.steps.transitDetails.stopDetails.departureStop.name',
              'routes.legs.steps.transitDetails.stopDetails.arrivalStop.name',
              'routes.legs.steps.transitDetails.stopDetails.departureTime',
              'routes.legs.steps.transitDetails.stopDetails.arrivalTime',
              'routes.legs.steps.transitDetails.localizedValues.departureTime.time',
              'routes.legs.steps.transitDetails.localizedValues.arrivalTime.time',
              'routes.legs.steps.transitDetails.transitLine',
              'routes.legs.steps.transitDetails.transitLine.nameShort',
              'routes.legs.steps.transitDetails.transitLine.name',
              'routes.legs.steps.transitDetails.transitLine.color',
              'routes.legs.steps.transitDetails.transitLine.textColor',
              'routes.legs.steps.transitDetails.transitLine.vehicle.type',
              'routes.legs.steps.transitDetails.transitLine.vehicle.name',
              'routes.legs.steps.transitDetails.transitLine.agencies.name',
            ].join(','),
          },
        }
      );

      const route = response.data?.routes?.[0];
      const encodedPolyline = route?.polyline?.encodedPolyline;
      const distanceMeters = route?.distanceMeters;
      const durationSeconds = parseDurationSeconds(route?.duration);
      const transitFareText = route?.localizedValues?.transitFare?.text;

      const steps: Array<{
        travelMode: string;
        instructions?: string;
        distanceMeters?: number;
        distanceText?: string;
        durationSeconds?: number;
        durationText?: string;
        transit?: {
          lineShortName?: string;
          lineName?: string;
          vehicleType?: string;
          agencyName?: string;
          headsign?: string;
          stopCount?: number;
          departureStopName?: string;
          arrivalStopName?: string;
          departureTime?: string;
          arrivalTime?: string;
          departureTimeText?: string;
          arrivalTimeText?: string;
          headwaySeconds?: number;
          waitMinutes?: number;
          color?: string;
          textColor?: string;
        };
      }> = [];

      const legs = Array.isArray(route?.legs) ? route.legs : [];
      for (const leg of legs) {
        const legSteps = Array.isArray(leg?.steps) ? leg.steps : [];
        for (const s of legSteps) {
          const travelMode = String(s?.travelMode || '');
          const stepDistanceMeters = typeof s?.distanceMeters === 'number' ? s.distanceMeters : undefined;
          const stepDurationSeconds = parseDurationSeconds(s?.staticDuration);
          const stepDistanceText = safeText(s?.localizedValues?.distance?.text);
          const stepDurationText = safeText(s?.localizedValues?.staticDuration?.text);
          const instructions = safeText(s?.navigationInstruction?.instructions);

          const base: any = {
            travelMode,
            instructions,
            distanceMeters: stepDistanceMeters,
            distanceText: stepDistanceText || formatDistance(stepDistanceMeters),
            durationSeconds: stepDurationSeconds,
            durationText: stepDurationText || formatDuration(stepDurationSeconds),
          };

          if (travelMode === 'TRANSIT' && s?.transitDetails) {
            const td = s.transitDetails;
            const headwaySeconds = parseDurationSeconds(td?.headway);
            const departureTimeIso = safeText(td?.stopDetails?.departureTime);
            const arrivalTimeIso = safeText(td?.stopDetails?.arrivalTime);
            base.transit = {
              lineShortName: safeText(td?.transitLine?.nameShort),
              lineName: safeText(td?.transitLine?.name),
              vehicleType: safeText(td?.transitLine?.vehicle?.type),
              agencyName: safeText(td?.transitLine?.agencies?.[0]?.name),
              headsign: safeText(td?.headsign),
              stopCount: typeof td?.stopCount === 'number' ? td.stopCount : undefined,
              departureStopName: safeText(td?.stopDetails?.departureStop?.name),
              arrivalStopName: safeText(td?.stopDetails?.arrivalStop?.name),
              departureTime: departureTimeIso,
              arrivalTime: arrivalTimeIso,
              departureTimeText: safeText(td?.localizedValues?.departureTime?.time?.text),
              arrivalTimeText: safeText(td?.localizedValues?.arrivalTime?.time?.text),
              headwaySeconds,
              waitMinutes: computeWaitMinutes(departureTimeIso),
              color: safeText(td?.transitLine?.color),
              textColor: safeText(td?.transitLine?.textColor),
            };
          }

          steps.push(base);
        }
      }

      if (!encodedPolyline) {
        return res.status(404).json({ error: 'No route found' });
      }

      return res.json({
        polyline: encodedPolyline,
        distanceText: formatDistance(distanceMeters),
        durationText: formatDuration(durationSeconds),
        transitFareText: safeText(transitFareText),
        steps,
      });
    } catch (error: any) {
      const msg =
        error?.response?.data?.error?.message ||
        error?.response?.data?.error_message ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to fetch directions';
      console.error('Routes API error:', msg);
      return res.status(500).json({ error: msg });
    }
  }
);

export default router;

