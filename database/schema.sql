-- Enable PostGIS extension for location queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Toilets table with all Phase 1 features
CREATE TABLE toilets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    location GEOGRAPHY(POINT, 4326) NOT NULL, -- WGS84 coordinates
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    
    -- Scores (1-5 scale)
    cleanliness_score DECIMAL(3,2) DEFAULT 0,
    smell_score DECIMAL(3,2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    
    -- Amenities (boolean)
    has_toilet_paper BOOLEAN DEFAULT false,
    has_bidet BOOLEAN DEFAULT false,
    has_seat_warmer BOOLEAN DEFAULT false,
    has_hand_soap BOOLEAN DEFAULT false,
    
    -- Physical details
    number_of_stalls INTEGER DEFAULT 1,
    toilet_type VARCHAR(20) CHECK (toilet_type IN ('squat', 'sit', 'both')),
    pay_to_enter BOOLEAN DEFAULT false,
    entry_fee DECIMAL(10,2),
    wheelchair_accessible BOOLEAN DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255), -- User ID or anonymous
    is_active BOOLEAN DEFAULT true,
    
    -- For duplicate detection
    normalized_name VARCHAR(255) -- Lowercase, trimmed for comparison
);

-- Create spatial index for location queries
CREATE INDEX idx_toilets_location ON toilets USING GIST(location);
CREATE INDEX idx_toilets_coordinates ON toilets(latitude, longitude);
CREATE INDEX idx_toilets_normalized_name ON toilets(normalized_name);

-- Toilet photos table
CREATE TABLE toilet_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toilet_id UUID NOT NULL REFERENCES toilets(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    photo_path TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by VARCHAR(255)
);

CREATE INDEX idx_toilet_photos_toilet_id ON toilet_photos(toilet_id);

-- Reviews table (for Phase 1 - storing individual reviews that contribute to scores)
CREATE TABLE toilet_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toilet_id UUID NOT NULL REFERENCES toilets(id) ON DELETE CASCADE,
    cleanliness_score INTEGER CHECK (cleanliness_score >= 1 AND cleanliness_score <= 5),
    smell_score INTEGER CHECK (smell_score >= 1 AND smell_score <= 5),
    review_text TEXT,
    reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by VARCHAR(255)
);

CREATE INDEX idx_toilet_reviews_toilet_id ON toilet_reviews(toilet_id);

-- Function to update toilet scores when reviews are added
CREATE OR REPLACE FUNCTION update_toilet_scores()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE toilets
    SET 
        cleanliness_score = (
            SELECT AVG(cleanliness_score)::DECIMAL(3,2)
            FROM toilet_reviews
            WHERE toilet_id = NEW.toilet_id AND cleanliness_score IS NOT NULL
        ),
        smell_score = (
            SELECT AVG(smell_score)::DECIMAL(3,2)
            FROM toilet_reviews
            WHERE toilet_id = NEW.toilet_id AND smell_score IS NOT NULL
        ),
        total_reviews = (
            SELECT COUNT(*)
            FROM toilet_reviews
            WHERE toilet_id = NEW.toilet_id
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.toilet_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update scores
CREATE TRIGGER trigger_update_toilet_scores
AFTER INSERT OR UPDATE ON toilet_reviews
FOR EACH ROW
EXECUTE FUNCTION update_toilet_scores();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for toilets table
CREATE TRIGGER trigger_update_toilets_updated_at
BEFORE UPDATE ON toilets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


