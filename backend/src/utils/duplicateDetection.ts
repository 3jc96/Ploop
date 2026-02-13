import pool from '../config/database';
import stringSimilarity from 'string-similarity';

interface ToiletLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * Check if a toilet is a duplicate based on location and name
 * Uses a 50-meter radius for location matching
 */
export async function checkDuplicate(
  location: ToiletLocation,
  excludeId?: string
): Promise<{ isDuplicate: boolean; duplicateId?: string; similarity?: number; reason?: string }> {
  const { latitude, longitude, name, address } = location;

  // Normalize name for comparison
  const normalizedName = name?.toLowerCase().trim().replace(/\s+/g, ' ');

  // Check for nearby toilets within 50 meters
  let locationQuery: string;
  let locationParams: any[];
  
  if (excludeId) {
    locationQuery = `
      SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
      FROM toilets
      WHERE is_active = true
        AND id != $3
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          50
        )
      ORDER BY distance
      LIMIT 1
    `;
    locationParams = [longitude, latitude, excludeId];
  } else {
    locationQuery = `
      SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
      FROM toilets
      WHERE is_active = true
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          50
        )
      ORDER BY distance
      LIMIT 1
    `;
    locationParams = [longitude, latitude];
  }
  
  const locationResult = await pool.query(locationQuery, locationParams);

  if (locationResult.rows.length > 0) {
    const duplicate = locationResult.rows[0];
    const distance = parseFloat(duplicate.distance);

    // If within 50 meters, check name similarity using fuzzy matching
    if (distance < 50 && normalizedName) {
      const duplicateNormalized = duplicate.name?.toLowerCase().trim().replace(/\s+/g, ' ');
      
      if (duplicateNormalized) {
        // Calculate fuzzy string similarity (0-1, where 1 is identical)
        const similarity = stringSimilarity.compareTwoStrings(normalizedName, duplicateNormalized);
        
        // Exact match
        if (similarity === 1 || duplicateNormalized === normalizedName) {
          return {
            isDuplicate: true,
            duplicateId: duplicate.id,
            similarity: 1,
            reason: `Exact match found: ${duplicate.name} (${Math.round(distance)}m away)`,
          };
        }
        
        // High similarity (catches typos, variations) - threshold 0.75
        if (similarity >= 0.75) {
          return {
            isDuplicate: true,
            duplicateId: duplicate.id,
            similarity: similarity,
            reason: `Similar name found: ${duplicate.name} (${(similarity * 100).toFixed(0)}% similar, ${Math.round(distance)}m away)`,
          };
        }
        
        // Substring match (e.g., "Starbucks" vs "Starbucks Coffee")
        if (duplicateNormalized.includes(normalizedName) || normalizedName.includes(duplicateNormalized)) {
          return {
            isDuplicate: true,
            duplicateId: duplicate.id,
            similarity: 0.8, // Approximate substring similarity
            reason: `Similar name found: ${duplicate.name} (${Math.round(distance)}m away)`,
          };
        }
      }
    }

    // Very close (within 10 meters) is likely a duplicate even without name match
    if (distance < 10) {
      return {
        isDuplicate: true,
        duplicateId: duplicate.id,
        reason: `Very close location found: ${duplicate.name} (${Math.round(distance)}m away)`,
      };
    }
  }

  // Check for exact name match within larger radius (200m) if name provided
  if (normalizedName) {
    let nameQuery: string;
    let nameParams: any[];
    
    if (excludeId) {
      nameQuery = `
        SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
        FROM toilets
        WHERE is_active = true
          AND id != $3
          AND normalized_name = $4
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            200
          )
        ORDER BY distance
        LIMIT 1
      `;
      nameParams = [longitude, latitude, excludeId, normalizedName];
    } else {
      nameQuery = `
        SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
        FROM toilets
        WHERE is_active = true
          AND normalized_name = $3
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            200
          )
        ORDER BY distance
        LIMIT 1
      `;
      nameParams = [longitude, latitude, normalizedName];
    }
    
    const nameResult = await pool.query(nameQuery, nameParams);

    if (nameResult.rows.length > 0) {
      const duplicate = nameResult.rows[0];
      return {
        isDuplicate: true,
        duplicateId: duplicate.id,
        reason: `Exact name match found: ${duplicate.name} (${Math.round(parseFloat(duplicate.distance))}m away)`,
      };
    }
  }

  return { isDuplicate: false };
}

