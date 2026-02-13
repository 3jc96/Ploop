# Duplicate Detection Strategy for Names/Variations

## Current Implementation

The current system uses:
1. **Location-based detection** (50m radius)
2. **Simple name matching**:
   - Exact match (case-insensitive)
   - Substring matching (e.g., "Starbucks" vs "Starbucks Coffee")
3. **Normalized names** (lowercase, trimmed)

## Limitations

Current system might miss:
- "McDonald's" vs "McDonalds"
- "Starbucks" vs "Starbucks Coffee Shop"
- "Restroom" vs "Bathroom" vs "Washroom"
- Typos: "Starbuks" vs "Starbucks"
- Abbreviations: "McD" vs "McDonald's"

## Proposed Solutions

### Option 1: Fuzzy String Matching (Recommended)

Use a string similarity library to detect similar names:

**Library**: `string-similarity` or `fuzzywuzzy` (JavaScript port)

**Approach**:
1. Calculate similarity score (0-1) between names
2. If similarity > 0.8 AND location within 50m → Flag as potential duplicate
3. Show similarity score to user with option to view existing

**Example**:
- "Starbucks" vs "Starbucks Coffee" → 0.85 similarity → Flag
- "McDonald's" vs "McDonalds" → 0.95 similarity → Flag
- "Restroom A" vs "Bathroom B" → 0.3 similarity → Allow (different locations)

**Pros**:
- Catches typos and variations
- Works well with location + name combination
- Configurable threshold

**Cons**:
- May have false positives (need good threshold)
- Requires additional dependency

### Option 2: Enhanced Normalization

Improve name normalization:

**Normalizations**:
- Remove common words: "the", "and", "restroom", "bathroom", "toilet"
- Expand abbreviations: "McD" → "McDonald's", "Starbux" → "Starbucks"
- Remove punctuation: "McDonald's" → "Mcdonalds"
- Handle pluralization: "Restrooms" → "Restroom"

**Approach**:
1. Normalize both names using same rules
2. Compare normalized versions
3. If match AND location close → Flag

**Pros**:
- No external dependencies
- Fast
- Handles common cases

**Cons**:
- Can't handle typos well
- Requires maintaining abbreviation dictionary

### Option 3: Hybrid Approach (Best)

Combine fuzzy matching + enhanced normalization:

1. **Normalize** names (remove common words, punctuation)
2. **Calculate similarity** using fuzzy matching
3. **Check location** proximity
4. **Score combination**: (name_similarity * 0.7) + (location_proximity_score * 0.3)
5. If combined score > threshold → Flag as duplicate

**Example Scoring**:
```
Name: "Starbucks Coffee" vs "Starbucks"
Location: 30m apart
Name similarity: 0.85
Location score: 0.7 (close)
Combined: (0.85 * 0.7) + (0.7 * 0.3) = 0.805 → Flag as duplicate
```

### Option 4: User-Suggested Merging

Allow users to suggest when toilets should be merged:

1. Show "This might be a duplicate" with existing toilet
2. User can:
   - View existing toilet
   - Mark as "Same Location" (links them)
   - Mark as "Different Location" (allows both)
   - Suggest merge to admins

## Recommended Implementation

**Phase 1 (Current)**: Basic normalization + exact/substring matching ✅

**Phase 2 (Improvement)**: Add fuzzy string matching
- Install `string-similarity`
- Add similarity calculation
- Threshold: 0.75-0.85 similarity + location within 50m
- Show similarity percentage to user

**Phase 3 (Advanced)**: 
- User feedback system
- Machine learning on merge decisions
- Abbreviation dictionary
- Multi-language support

## Implementation Priority

1. **High Priority**: Fuzzy string matching (catches most variations)
2. **Medium Priority**: Enhanced normalization (handles common cases)
3. **Low Priority**: User merge suggestions (nice to have)

## Code Example (Fuzzy Matching)

```typescript
import stringSimilarity from 'string-similarity';

function checkNameSimilarity(name1: string, name2: string): number {
  const similarity = stringSimilarity.compareTwoStrings(
    name1.toLowerCase().trim(),
    name2.toLowerCase().trim()
  );
  return similarity; // 0-1, where 1 is identical
}

// In duplicate detection:
const nameSimilarity = checkNameSimilarity(newName, existingName);
if (nameSimilarity > 0.8 && distance < 50) {
  return {
    isDuplicate: true,
    similarity: nameSimilarity,
    reason: `Similar name found: ${existingName} (${(nameSimilarity * 100).toFixed(0)}% similar, ${distance}m away)`
  };
}
```

## Decision Matrix

| Scenario | Current | With Fuzzy | With Hybrid |
|----------|---------|------------|-------------|
| "Starbucks" vs "Starbucks Coffee" | ✅ Catch | ✅ Catch | ✅ Catch |
| "McDonald's" vs "McDonalds" | ❌ Miss | ✅ Catch | ✅ Catch |
| "Starbuks" (typo) vs "Starbucks" | ❌ Miss | ✅ Catch | ✅ Catch |
| Different locations, similar names | ✅ Allow | ✅ Allow | ✅ Allow |
| Same location, different names | ✅ Allow | ✅ Allow | ⚠️ Review |

## Next Steps

Would you like me to:
1. Implement fuzzy string matching (recommended)?
2. Enhance name normalization?
3. Implement hybrid approach?
4. All of the above?


