import express, { Request, Response } from 'express';
import '../types/auth';
import { body, param, query, validationResult } from 'express-validator';
import pool from '../config/database';
import { requireAuth } from '../middleware/auth';
import { checkDuplicate } from '../utils/duplicateDetection';
import { CreateToiletRequest, UpdateToiletRequest, NearbyToiletsQuery } from '../types/toilet';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import stringSimilarity from 'string-similarity';

const router = express.Router();

// Fetch a toilet by Google Place ID (for POI-tap consistency)
router.get(
  '/by-place/:placeId',
  [param('placeId').isString().trim().notEmpty()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { placeId } = req.params as any;

      try {
        const result = await pool.query(
          `SELECT * FROM toilets WHERE is_active = true AND google_place_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [placeId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json(result.rows[0]);
      } catch (e: any) {
        // If the column isn't present in an older DB, behave as not-found.
        if (e?.code === '42703') return res.status(404).json({ error: 'Not found' });
        throw e;
      }
    } catch (error) {
      console.error('Error fetching toilet by placeId:', error);
      res.status(500).json({ error: 'Failed to fetch toilet' });
    }
  }
);

function computeConfidenceScore(toilet: any): number {
  // v1 heuristic:
  // - base from avg rating (cleanliness+smell)/2 scaled to 70
  // - review volume boosts up to +20
  // - recency proxy: updated_at boosts up to +10 (decays over 30 days)
  const c = typeof toilet.cleanliness_score === 'number' ? toilet.cleanliness_score : parseFloat(toilet.cleanliness_score);
  const s = typeof toilet.smell_score === 'number' ? toilet.smell_score : parseFloat(toilet.smell_score);
  const avg = Number.isFinite(c) && Number.isFinite(s) ? (c + s) / 2 : Number.isFinite(c) ? c : Number.isFinite(s) ? s : 0;

  const ratingComponent = Math.max(0, Math.min(5, avg)) / 5 * 70;
  const reviews = typeof toilet.total_reviews === 'number' ? toilet.total_reviews : parseInt(toilet.total_reviews || '0', 10) || 0;
  const volumeComponent = Math.min(20, Math.log10(Math.max(1, reviews)) * 10);

  let recencyComponent = 0;
  try {
    const updatedAt = new Date(toilet.updated_at);
    const ageDays = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    recencyComponent = Math.max(0, Math.min(10, 10 - (ageDays / 30) * 10));
  } catch {
    recencyComponent = 0;
  }

  let score = ratingComponent + volumeComponent + recencyComponent;

  // Penalize if there are active negative reports (added later in mapping if present)
  return Math.round(Math.max(0, Math.min(100, score)));
}

// Configure multer for file uploads
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Get nearby toilets
router.get(
  '/',
  [
    query('latitude').isFloat({ min: -90, max: 90 }),
    query('longitude').isFloat({ min: -180, max: 180 }),
    query('radius').optional().isInt({ min: 100, max: 10000 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('wheelchair_accessible').optional().isBoolean(),
    query('free_only').optional().isBoolean(),
    query('min_confidence').optional().isInt({ min: 0, max: 100 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { latitude, longitude, radius = 1000, limit = 50, wheelchair_accessible, free_only, min_confidence } = req.query as any;
      const query: NearbyToiletsQuery = {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: parseInt(radius),
        limit: parseInt(limit),
      };

      const params: any[] = [query.longitude, query.latitude, query.radius, query.limit];
      let whereExtra = '';
      if (typeof wheelchair_accessible !== 'undefined') {
        const v = wheelchair_accessible === true || wheelchair_accessible === 'true';
        params.push(v);
        whereExtra += ` AND t.wheelchair_accessible = $${params.length}`;
      }
      if (free_only === true || free_only === 'true') {
        whereExtra += ` AND t.pay_to_enter = false`;
      }

      const result = await pool.query(
        `
        SELECT 
          t.*,
          ST_Distance(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance,
          COALESCE(rp.active_reports, 0) as active_reports,
          COALESCE(rp.report_summary, '[]'::jsonb) as report_summary,
          COALESCE(
            json_agg(
              json_build_object(
                'id', tp.id,
                'photo_url', tp.photo_url,
                'uploaded_at', tp.uploaded_at
              )
            ) FILTER (WHERE tp.id IS NOT NULL),
            '[]'
          ) as photos
        FROM toilets t
        LEFT JOIN (
          SELECT
            toilet_id,
            COUNT(*) FILTER (WHERE expires_at > now())::int as active_reports,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'type', report_type,
                  'note', note,
                  'created_at', created_at,
                  'expires_at', expires_at
                )
              ) FILTER (WHERE expires_at > now()),
              '[]'::jsonb
            ) as report_summary
          FROM toilet_reports
          GROUP BY toilet_id
        ) rp ON rp.toilet_id = t.id
        LEFT JOIN toilet_photos tp ON t.id = tp.toilet_id
        WHERE t.is_active = true
          ${whereExtra}
          AND ST_DWithin(
            t.location,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
          )
        GROUP BY t.id, rp.active_reports, rp.report_summary
        ORDER BY distance
        LIMIT $4
        `,
        params
      );

      let toilets = result.rows.map((row) => {
        const { distance, photos, active_reports, report_summary, ...toilet } = row;
        const confidenceBase = computeConfidenceScore(toilet);
        const reportPenalty = Math.min(35, (parseInt(active_reports || '0', 10) || 0) * 8);
        const confidence_score = Math.max(0, Math.min(100, confidenceBase - reportPenalty));
        return {
          ...toilet,
          distance: Math.round(parseFloat(distance)),
          photos: photos || [],
          confidence_score,
          last_verified_at: toilet.updated_at,
          active_reports: parseInt(active_reports || '0', 10) || 0,
          report_summary: report_summary || [],
        };
      });

      if (typeof min_confidence !== 'undefined') {
        const min = Math.max(0, Math.min(100, parseInt(min_confidence, 10) || 0));
        toilets = toilets.filter((t: any) => (typeof t.confidence_score === 'number' ? t.confidence_score : 0) >= min);
      }

      res.json({ toilets, count: toilets.length });
    } catch (error) {
      console.error('Error fetching nearby toilets:', error);
      res.status(500).json({ error: 'Failed to fetch toilets' });
    }
  }
);

// Get toilet by ID
router.get(
  '/:id',
  [param('id').isUUID()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const result = await pool.query(
        `
        SELECT 
          t.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', tp.id,
                'photo_url', tp.photo_url,
                'uploaded_at', tp.uploaded_at
              )
            ) FILTER (WHERE tp.id IS NOT NULL),
            '[]'
          ) as photos
        FROM toilets t
        LEFT JOIN toilet_photos tp ON t.id = tp.toilet_id
        WHERE t.id = $1 AND t.is_active = true
        GROUP BY t.id
        `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Toilet not found' });
      }

      const toilet = result.rows[0];
      toilet.photos = toilet.photos || [];

      res.json(toilet);
    } catch (error) {
      console.error('Error fetching toilet:', error);
      res.status(500).json({ error: 'Failed to fetch toilet' });
    }
  }
);

// Mark toilet as just cleaned/serviced (for businesses)
router.post(
  '/:id/serviced',
  [param('id').isUUID()],
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id } = req.params;
      const result = await pool.query(
        `UPDATE toilets SET last_serviced_at = now(), updated_at = now()
         WHERE id = $1 AND is_active = true
         RETURNING id, name, last_serviced_at`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Toilet not found' });
      }
      res.json({ toilet: result.rows[0], message: 'Marked as just cleaned' });
    } catch (e: any) {
      if (e?.code === '42703') {
        return res.status(500).json({ error: 'Database schema may be outdated. Please redeploy.' });
      }
      console.error('Error marking toilet serviced:', e);
      res.status(500).json({ error: 'Failed to update' });
    }
  }
);

// Check for duplicates
router.post(
  '/check-duplicate',
  [
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('name').optional().isString().trim(),
    body('address').optional().isString().trim(),
    body('excludeId').optional().isUUID(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { latitude, longitude, name, address, excludeId } = req.body;
      const duplicateCheck = await checkDuplicate(
        { latitude, longitude, name, address },
        excludeId
      );

      res.json(duplicateCheck);
    } catch (error) {
      console.error('Error checking duplicate:', error);
      res.status(500).json({ error: 'Failed to check for duplicates' });
    }
  }
);

// Search for similar toilet names (for autocomplete)
router.get(
  '/search-names',
  [
    query('query').isString().trim().notEmpty(),
    query('latitude').optional().isFloat({ min: -90, max: 90 }),
    query('longitude').optional().isFloat({ min: -180, max: 180 }),
    query('radius').optional().isInt({ min: 100, max: 10000 }),
    query('limit').optional().isInt({ min: 1, max: 20 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { query: searchQuery, latitude, longitude, radius = 2000, limit = 10 } = req.query as any;
      const normalizedQuery = searchQuery.toLowerCase().trim();

      let sqlQuery: string;
      let params: any[];

      if (latitude && longitude) {
        // Search within radius
        sqlQuery = `
          SELECT id, name, address, latitude, longitude,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
          FROM toilets
          WHERE is_active = true
            AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              $3
            )
            AND (
              normalized_name LIKE $4
              OR name ILIKE $4
            )
          ORDER BY distance
          LIMIT $5
        `;
        params = [longitude, latitude, radius, `%${normalizedQuery}%`, limit];
      } else {
        // Search globally
        sqlQuery = `
          SELECT id, name, address, latitude, longitude
          FROM toilets
          WHERE is_active = true
            AND (
              normalized_name LIKE $1
              OR name ILIKE $1
            )
          ORDER BY name
          LIMIT $2
        `;
        params = [`%${normalizedQuery}%`, limit];
      }

      const result = await pool.query(sqlQuery, params);
      
      // Calculate similarity scores and sort by relevance
      const suggestions = result.rows.map((toilet: any) => {
        const similarity = stringSimilarity.compareTwoStrings(
          normalizedQuery,
          toilet.name.toLowerCase().trim()
        );
        return {
          ...toilet,
          similarity: similarity,
          distance: toilet.distance ? Math.round(parseFloat(toilet.distance)) : null,
        };
      }).sort((a: any, b: any) => {
        // Sort by similarity (highest first), then by distance if available
        if (Math.abs(a.similarity - b.similarity) > 0.1) {
          return b.similarity - a.similarity;
        }
        if (a.distance !== null && b.distance !== null) {
          return a.distance - b.distance;
        }
        return 0;
      });

      res.json({ suggestions: suggestions.slice(0, limit) });
    } catch (error) {
      console.error('Error searching names:', error);
      res.status(500).json({ error: 'Failed to search names' });
    }
  }
);

// Create new toilet
router.post(
  '/',
  [
    body('name').isString().trim().notEmpty(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('address').optional().isString().trim(),
    body('google_place_id').optional().isString().trim().notEmpty(),
    body('has_toilet_paper').isBoolean(),
    body('has_bidet').isBoolean(),
    body('has_seat_warmer').isBoolean(),
    body('has_hand_soap').isBoolean(),
    body('has_baby_changing').optional().isBoolean(),
    body('has_family_room').optional().isBoolean(),
    body('number_of_stalls').isInt({ min: 1 }),
    body('toilet_type').isIn(['squat', 'sit', 'both']),
    body('pay_to_enter').isBoolean(),
    body('entry_fee').optional().isFloat({ min: 0 }),
    body('wheelchair_accessible').isBoolean(),
    body('cleanliness_score').optional().isInt({ min: 1, max: 5 }),
    body('smell_score').optional().isInt({ min: 1, max: 5 }),
    body('created_by').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const data: CreateToiletRequest = req.body;

      // Check for duplicates
      const duplicateCheck = await checkDuplicate({
        latitude: data.latitude,
        longitude: data.longitude,
        name: data.name,
        address: data.address,
      });

      if (duplicateCheck.isDuplicate) {
        return res.status(409).json({
          error: 'Duplicate toilet detected',
          ...duplicateCheck,
        });
      }

      // Normalize name for duplicate detection
      const normalizedName = data.name.toLowerCase().trim().replace(/\s+/g, ' ');

      // Insert toilet (include has_baby_changing, has_family_room if columns exist)
      const result = await pool.query(
        `
        INSERT INTO toilets (
          name, address, latitude, longitude, location,
          has_toilet_paper, has_bidet, has_seat_warmer, has_hand_soap,
          has_baby_changing, has_family_room,
          number_of_stalls, toilet_type, pay_to_enter, entry_fee,
          wheelchair_accessible, created_by, normalized_name, google_place_id
        )
        VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *
        `,
        [
          data.name,
          data.address || null,
          data.latitude,
          data.longitude,
          data.has_toilet_paper,
          data.has_bidet,
          data.has_seat_warmer,
          data.has_hand_soap,
          data.has_baby_changing ?? false,
          data.has_family_room ?? false,
          data.number_of_stalls,
          data.toilet_type,
          data.pay_to_enter,
          data.entry_fee || null,
          data.wheelchair_accessible,
          data.created_by || null,
          normalizedName,
          (data as any).google_place_id || null,
        ]
      );

      const toilet = result.rows[0];

      // If initial scores provided, create review
      if (data.cleanliness_score || data.smell_score) {
        await pool.query(
          `
          INSERT INTO toilet_reviews (toilet_id, cleanliness_score, smell_score, reviewed_by)
          VALUES ($1, $2, $3, $4)
          `,
          [
            toilet.id,
            data.cleanliness_score || null,
            data.smell_score || null,
            data.created_by || null,
          ]
        );
      }

      // Fetch updated toilet with scores
      const updatedResult = await pool.query('SELECT * FROM toilets WHERE id = $1', [toilet.id]);
      const updatedToilet = updatedResult.rows[0];

      res.status(201).json(updatedToilet);
    } catch (error: any) {
      console.error('Error creating toilet:', error);
      const msg = error?.message || String(error);
      const hint = error?.code === '42703' ? 'Database schema may be outdated.' : msg;
      res.status(500).json({
        error: 'Failed to create toilet',
        detail: process.env.NODE_ENV === 'production' ? undefined : hint,
      });
    }
  }
);

// Update toilet
router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('address').optional().isString().trim(),
    body('google_place_id').optional().isString().trim().notEmpty(),
    body('has_toilet_paper').optional().isBoolean(),
    body('has_bidet').optional().isBoolean(),
    body('has_seat_warmer').optional().isBoolean(),
    body('has_hand_soap').optional().isBoolean(),
    body('has_baby_changing').optional().isBoolean(),
    body('has_family_room').optional().isBoolean(),
    body('number_of_stalls').optional().isInt({ min: 1 }),
    body('toilet_type').optional().isIn(['squat', 'sit', 'both']),
    body('pay_to_enter').optional().isBoolean(),
    body('entry_fee').optional().isFloat({ min: 0 }),
    body('wheelchair_accessible').optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const updates: Partial<CreateToiletRequest> = req.body;

      // Check if toilet exists
      const existingResult = await pool.query('SELECT * FROM toilets WHERE id = $1', [id]);
      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: 'Toilet not found' });
      }

      // If location changed, check for duplicates
      if (updates.latitude && updates.longitude) {
        const duplicateCheck = await checkDuplicate(
          {
            latitude: updates.latitude,
            longitude: updates.longitude,
            name: updates.name || existingResult.rows[0].name,
            address: updates.address || existingResult.rows[0].address,
          },
          id
        );

        if (duplicateCheck.isDuplicate) {
          return res.status(409).json({
            error: 'Duplicate toilet detected',
            ...duplicateCheck,
          });
        }
      }

      // Build update query dynamically
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (updates.name) {
        updateFields.push(`name = $${paramIndex++}`);
        updateValues.push(updates.name);
        updateFields.push(`normalized_name = $${paramIndex++}`);
        updateValues.push(updates.name.toLowerCase().trim().replace(/\s+/g, ' '));
      }
      if (updates.address !== undefined) {
        updateFields.push(`address = $${paramIndex++}`);
        updateValues.push(updates.address);
      }
      if ((updates as any).google_place_id !== undefined) {
        updateFields.push(`google_place_id = $${paramIndex++}`);
        updateValues.push((updates as any).google_place_id);
      }
      if (updates.latitude && updates.longitude) {
        updateFields.push(`latitude = $${paramIndex++}`);
        updateValues.push(updates.latitude);
        updateFields.push(`longitude = $${paramIndex++}`);
        updateValues.push(updates.longitude);
        updateFields.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex - 1}, $${paramIndex - 2}), 4326)::geography`);
      }
      if (updates.has_toilet_paper !== undefined) {
        updateFields.push(`has_toilet_paper = $${paramIndex++}`);
        updateValues.push(updates.has_toilet_paper);
      }
      if (updates.has_bidet !== undefined) {
        updateFields.push(`has_bidet = $${paramIndex++}`);
        updateValues.push(updates.has_bidet);
      }
      if (updates.has_seat_warmer !== undefined) {
        updateFields.push(`has_seat_warmer = $${paramIndex++}`);
        updateValues.push(updates.has_seat_warmer);
      }
      if (updates.has_hand_soap !== undefined) {
        updateFields.push(`has_hand_soap = $${paramIndex++}`);
        updateValues.push(updates.has_hand_soap);
      }
      if ((updates as any).has_baby_changing !== undefined) {
        updateFields.push(`has_baby_changing = $${paramIndex++}`);
        updateValues.push((updates as any).has_baby_changing);
      }
      if ((updates as any).has_family_room !== undefined) {
        updateFields.push(`has_family_room = $${paramIndex++}`);
        updateValues.push((updates as any).has_family_room);
      }
      if (updates.number_of_stalls !== undefined) {
        updateFields.push(`number_of_stalls = $${paramIndex++}`);
        updateValues.push(updates.number_of_stalls);
      }
      if (updates.toilet_type !== undefined) {
        updateFields.push(`toilet_type = $${paramIndex++}`);
        updateValues.push(updates.toilet_type);
      }
      if (updates.pay_to_enter !== undefined) {
        updateFields.push(`pay_to_enter = $${paramIndex++}`);
        updateValues.push(updates.pay_to_enter);
      }
      if (updates.entry_fee !== undefined) {
        updateFields.push(`entry_fee = $${paramIndex++}`);
        updateValues.push(updates.entry_fee);
      }
      if (updates.wheelchair_accessible !== undefined) {
        updateFields.push(`wheelchair_accessible = $${paramIndex++}`);
        updateValues.push(updates.wheelchair_accessible);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updateValues.push(id);
      const query = `UPDATE toilets SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

      const result = await pool.query(query, updateValues);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating toilet:', error);
      res.status(500).json({ error: 'Failed to update toilet' });
    }
  }
);

// Upload photo for toilet
router.post(
  '/:id/photo',
  [param('id').isUUID()],
  upload.single('photo'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No photo file provided' });
      }

      const { id } = req.params;
      const photoPath = req.file.path;
      const photoUrl = `/uploads/${req.file.filename}`;

      // Check if toilet exists
      const toiletResult = await pool.query('SELECT id FROM toilets WHERE id = $1', [id]);
      if (toiletResult.rows.length === 0) {
        fs.unlinkSync(photoPath); // Delete uploaded file
        return res.status(404).json({ error: 'Toilet not found' });
      }

      // Insert photo record
      const result = await pool.query(
        `
        INSERT INTO toilet_photos (toilet_id, photo_url, photo_path, uploaded_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [id, photoUrl, photoPath, req.body.uploaded_by || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error uploading photo:', error);
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: 'Failed to upload photo' });
    }
  }
);

// List reviews for a toilet (so clients can show "your review" and edit/delete)
router.get(
  '/:id/reviews',
  [param('id').isUUID()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id } = req.params;
      const toiletResult = await pool.query('SELECT id FROM toilets WHERE id = $1', [id]);
      if (toiletResult.rows.length === 0) {
        return res.status(404).json({ error: 'Toilet not found' });
      }
      const result = await pool.query(
        `SELECT id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_at, reviewed_by, user_id
         FROM toilet_reviews WHERE toilet_id = $1 ORDER BY reviewed_at DESC`,
        [id]
      );
      res.json({ reviews: result.rows });
    } catch (error) {
      console.error('Error listing reviews:', error);
      res.status(500).json({ error: 'Failed to list reviews' });
    }
  }
);

// Add review for toilet (user_id set when authenticated)
router.post(
  '/:id/review',
  [
    param('id').isUUID(),
    body('cleanliness_score').optional().isInt({ min: 1, max: 5 }),
    body('smell_score').optional().isInt({ min: 1, max: 5 }),
    body('review_text').optional().isString().trim(),
    body('reviewed_by').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { cleanliness_score, smell_score, review_text, reviewed_by } = req.body;
      const user = req.user;
      const user_id = user?.id || null;
      const reviewed_by_display = reviewed_by || (user ? (user.display_name || user.email) : null);

      // Check if toilet exists
      const toiletResult = await pool.query('SELECT id FROM toilets WHERE id = $1', [id]);
      if (toiletResult.rows.length === 0) {
        return res.status(404).json({ error: 'Toilet not found' });
      }

      if (!cleanliness_score && !smell_score) {
        return res.status(400).json({ error: 'At least one score is required' });
      }

      const result = await pool.query(
        `
        INSERT INTO toilet_reviews (toilet_id, cleanliness_score, smell_score, review_text, reviewed_by, user_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [id, cleanliness_score || null, smell_score || null, review_text || null, reviewed_by_display, user_id]
      );

      const updatedResult = await pool.query('SELECT * FROM toilets WHERE id = $1', [id]);
      res.status(201).json({
        review: result.rows[0],
        toilet: updatedResult.rows[0],
      });
    } catch (error) {
      console.error('Error adding review:', error);
      res.status(500).json({ error: 'Failed to add review' });
    }
  }
);

// Update own review
router.patch(
  '/:id/reviews/:reviewId',
  [
    param('id').isUUID(),
    param('reviewId').isUUID(),
    body('cleanliness_score').optional().isInt({ min: 1, max: 5 }),
    body('smell_score').optional().isInt({ min: 1, max: 5 }),
    body('review_text').optional().isString().trim(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required to edit a review' });
      }
      const { id, reviewId } = req.params;
      const { cleanliness_score, smell_score, review_text } = req.body;

      const reviewRow = await pool.query(
        'SELECT id, user_id FROM toilet_reviews WHERE id = $1 AND toilet_id = $2',
        [reviewId, id]
      );
      if (reviewRow.rows.length === 0) {
        return res.status(404).json({ error: 'Review not found' });
      }
      if (reviewRow.rows[0].user_id !== user.id) {
        return res.status(403).json({ error: 'You can only edit your own review' });
      }

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;
      if (cleanliness_score !== undefined) {
        updates.push(`cleanliness_score = $${idx++}`);
        values.push(cleanliness_score);
      }
      if (smell_score !== undefined) {
        updates.push(`smell_score = $${idx++}`);
        values.push(smell_score);
      }
      if (review_text !== undefined) {
        updates.push(`review_text = $${idx++}`);
        values.push(review_text);
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      values.push(reviewId);
      const result = await pool.query(
        `UPDATE toilet_reviews SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      const updatedToilet = await pool.query('SELECT * FROM toilets WHERE id = $1', [id]);
      res.json({ review: result.rows[0], toilet: updatedToilet.rows[0] });
    } catch (error) {
      console.error('Error updating review:', error);
      res.status(500).json({ error: 'Failed to update review' });
    }
  }
);

// Delete own review
router.delete(
  '/:id/reviews/:reviewId',
  [param('id').isUUID(), param('reviewId').isUUID()],
  async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required to delete a review' });
      }
      const { id, reviewId } = req.params;

      const reviewRow = await pool.query(
        'SELECT id, user_id FROM toilet_reviews WHERE id = $1 AND toilet_id = $2',
        [reviewId, id]
      );
      if (reviewRow.rows.length === 0) {
        return res.status(404).json({ error: 'Review not found' });
      }
      if (reviewRow.rows[0].user_id !== user.id) {
        return res.status(403).json({ error: 'You can only delete your own review' });
      }

      await pool.query('DELETE FROM toilet_reviews WHERE id = $1', [reviewId]);
      const updatedToilet = await pool.query('SELECT * FROM toilets WHERE id = $1', [id]);
      res.json({ ok: true, toilet: updatedToilet.rows[0] });
    } catch (error) {
      console.error('Error deleting review:', error);
      res.status(500).json({ error: 'Failed to delete review' });
    }
  }
);

export default router;

