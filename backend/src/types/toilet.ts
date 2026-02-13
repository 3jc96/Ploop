export interface Toilet {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  google_place_id?: string;
  cleanliness_score: number | null;
  smell_score: number | null;
  total_reviews: number;
  has_toilet_paper: boolean;
  has_bidet: boolean;
  has_seat_warmer: boolean;
  has_hand_soap: boolean;
  number_of_stalls: number;
  toilet_type: 'squat' | 'sit' | 'both';
  pay_to_enter: boolean;
  entry_fee?: number;
  wheelchair_accessible: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  is_active: boolean;
  photos?: string[];
}

export interface CreateToiletRequest {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  google_place_id?: string;
  cleanliness_score?: number;
  smell_score?: number;
  has_toilet_paper: boolean;
  has_bidet: boolean;
  has_seat_warmer: boolean;
  has_hand_soap: boolean;
  number_of_stalls: number;
  toilet_type: 'squat' | 'sit' | 'both';
  pay_to_enter: boolean;
  entry_fee?: number;
  wheelchair_accessible: boolean;
  created_by?: string;
}

export interface UpdateToiletRequest extends Partial<CreateToiletRequest> {
  id: string;
}

export interface NearbyToiletsQuery {
  latitude: number;
  longitude: number;
  radius?: number; // in meters, default 1000
  limit?: number; // default 50
}

