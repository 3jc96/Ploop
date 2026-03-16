import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  TextInput,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getErrorMessage, getReviewSuccessMessage, hapticSuccess } from '../utils/engagement';
import { playFlushSound } from '../utils/flushSound';

interface LocationReviewParams {
  latitude: number;
  longitude: number;
  placeId?: string;
  placeName?: string;
  placeAddress?: string;
}

const LocationReviewScreen: React.FC = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { latitude, longitude, placeId, placeName, placeAddress } = (route.params || {}) as LocationReviewParams;
  
  const [loading, setLoading] = useState(true);
  const [locationDetails, setLocationDetails] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Review scores
  const [reviewCleanliness, setReviewCleanliness] = useState<number | null>(null);
  const [reviewSmell, setReviewSmell] = useState<number | null>(null);
  
  // Amenities
  const [hasToiletPaper, setHasToiletPaper] = useState(false);
  const [hasBidet, setHasBidet] = useState(false);
  const [hasSeatWarmer, setHasSeatWarmer] = useState(false);
  const [hasHandSoap, setHasHandSoap] = useState(false);
  const [hasBabyChanging, setHasBabyChanging] = useState(false);
  const [hasFamilyRoom, setHasFamilyRoom] = useState(false);
  
  // Physical details
  const [numberOfStalls, setNumberOfStalls] = useState(1);
  const [toiletType, setToiletType] = useState<'sit' | 'squat' | 'both'>('sit');
  const [payToEnter, setPayToEnter] = useState(false);
  const [entryFee, setEntryFee] = useState<string>('');
  const [wheelchairAccessible, setWheelchairAccessible] = useState(false);

  useEffect(() => {
    if (typeof latitude === 'number' && typeof longitude === 'number') loadLocationDetails();
    else setLoading(false);
  }, [latitude, longitude]);

  const loadLocationDetails = async () => {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
    try {
      setLoading(true);
      api.track('review_started', { latitude, longitude, placeId: placeId || null });
      const details = await api.getLocationDetails({
        latitude,
        longitude,
      });
      setLocationDetails(details);
    } catch (error: any) {
      console.error('Error loading location details:', error);
      Alert.alert('Error', getErrorMessage(error, 'Failed to load location details.'));
    } finally {
      setLoading(false);
    }
  };

  const submitReview = async () => {
    if (!reviewCleanliness && !reviewSmell) {
      Alert.alert('Error', 'Please rate at least cleanliness or smell.');
      return;
    }

    try {
      setSubmitting(true);
      
      // Get location name - prioritize place name from Google
      const locationName = locationDetails?.place?.name || placeName || locationDetails?.location?.address || 'Unknown Location';
      const locationAddress = locationDetails?.place?.address || placeAddress || locationDetails?.location?.address || '';
      
      // Prefer exact POI mapping when we have a Google placeId.
      let matchedToilet = placeId ? await api.getToiletByPlaceId(placeId) : null;

      // Fallback: check for existing toilets nearby
      if (!matchedToilet) {
        const { toilets } = await api.getNearbyToilets({
          latitude,
          longitude,
          // Backend validation enforces radius >= 100
          radius: 100, // 100m radius
          limit: 1,
        });
        matchedToilet = toilets && toilets.length > 0 ? toilets[0] : null;
      }

      let toiletId: string;
      if (matchedToilet) {
        // Use existing toilet and update it
        toiletId = matchedToilet.id;
        await api.updateToilet(toiletId, {
          has_toilet_paper: hasToiletPaper,
          has_bidet: hasBidet,
          has_seat_warmer: hasSeatWarmer,
          has_hand_soap: hasHandSoap,
          has_baby_changing: hasBabyChanging,
          has_family_room: hasFamilyRoom,
          number_of_stalls: numberOfStalls,
          toilet_type: toiletType,
          pay_to_enter: payToEnter,
          entry_fee: entryFee ? parseFloat(entryFee) : undefined,
          wheelchair_accessible: wheelchairAccessible,
          google_place_id: placeId || undefined,
        });
      } else {
        // Create new toilet at this location (link to user when signed in)
        const newToilet = await api.createToilet({
          name: locationName,
          address: locationAddress,
          latitude,
          longitude,
          google_place_id: placeId || undefined,
          has_toilet_paper: hasToiletPaper,
          has_bidet: hasBidet,
          has_seat_warmer: hasSeatWarmer,
          has_hand_soap: hasHandSoap,
          has_baby_changing: hasBabyChanging,
          has_family_room: hasFamilyRoom,
          number_of_stalls: numberOfStalls,
          toilet_type: toiletType,
          pay_to_enter: payToEnter,
          entry_fee: entryFee ? parseFloat(entryFee) : undefined,
          wheelchair_accessible: wheelchairAccessible,
          created_by: user?.id,
        });
        toiletId = newToilet.id;
      }

      // Submit review scores
      await api.addReview(toiletId, {
        cleanliness_score: reviewCleanliness || undefined,
        smell_score: reviewSmell || undefined,
        review_text: reviewText.trim() || undefined,
      });

      api.track('review_submitted', {
        toiletId,
        cleanliness: reviewCleanliness,
        smell: reviewSmell,
        hasText: !!reviewText.trim(),
      });
      await api.bumpLocalMetric('reviews', 1);
      const { reviews } = await api.getLocalMetrics();
      const message = getReviewSuccessMessage(reviews);
      await hapticSuccess();
      playFlushSound();

      Alert.alert('Success', message, [
        {
          text: 'OK',
          onPress: () => {
            (navigation as any).goBack();
          },
        },
      ]);
    } catch (error: any) {
      console.error('Error submitting review:', error);
      Alert.alert('Error', getErrorMessage(error, 'Failed to submit review.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Missing location. Go back and tap a place on the map.</Text>
        <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const place = locationDetails?.place;
  const location = locationDetails?.location;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 140 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled
        bounces
        alwaysBounceVertical
        showsVerticalScrollIndicator
      >
        <View style={styles.header}>
          <Text style={styles.title}>
            {place?.name || location?.address || 'Review Location'}
          </Text>
          {place?.address && (
            <Text style={styles.address}>{place.address}</Text>
          )}
          {location?.address && !place?.address && (
            <Text style={styles.address}>{location.address}</Text>
          )}
        </View>

      {/* Google Reviews Section */}
      {place?.googleRating && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Google Reviews</Text>
          <View style={styles.googleRatingContainer}>
            <Text style={styles.googleRating}>{place.googleRating.toFixed(1)}</Text>
            <Text style={styles.googleRatingLabel}>
              ({place.googleReviewCount || 0} reviews)
            </Text>
          </View>
          
          {place.googleReviews && place.googleReviews.length > 0 && (
            <View style={styles.reviewsContainer}>
              {place.googleReviews.slice(0, 3).map((review: any, index: number) => (
                <View key={index} style={styles.reviewItem}>
                  <View style={styles.reviewHeader}>
                    <Text style={styles.reviewAuthor}>{review.author}</Text>
                    <Text style={styles.reviewRating}>⭐ {review.rating}/5</Text>
                  </View>
                  <Text style={styles.reviewText}>{review.text}</Text>
                  <Text style={styles.reviewTime}>{review.relativeTime}</Text>
                </View>
              ))}
            </View>
          )}
          
          <Text style={styles.note}>
            Note: We display Google Reviews for reference. Your review will be added to Ploop's database.
          </Text>
        </View>
      )}

      {/* Ploop Review Section */}
        <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add Your Review</Text>
        <Text style={styles.sectionSubtitle}>
          Quick ratings first (10 seconds). Add details if you want.
        </Text>

        {/* Scores */}
        <View style={styles.ratingContainer}>
          <View style={styles.ratingItem}>
            <Text style={styles.ratingLabel}>Cleanliness *</Text>
            <View style={styles.ratingButtons}>
              {[1, 2, 3, 4, 5].map((score) => (
                <TouchableOpacity
                  key={score}
                  style={[
                    styles.ratingButton,
                    reviewCleanliness === score && styles.ratingButtonActive,
                  ]}
                  onPress={() => setReviewCleanliness(score)}
                >
                  <Text
                    style={[
                      styles.ratingButtonText,
                      reviewCleanliness === score && styles.ratingButtonTextActive,
                    ]}
                  >
                    {score}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.ratingItem}>
            <Text style={styles.ratingLabel}>Smell *</Text>
            <View style={styles.ratingButtons}>
              {[1, 2, 3, 4, 5].map((score) => (
                <TouchableOpacity
                  key={score}
                  style={[
                    styles.ratingButton,
                    reviewSmell === score && styles.ratingButtonActive,
                  ]}
                  onPress={() => setReviewSmell(score)}
                >
                  <Text
                    style={[
                      styles.ratingButtonText,
                      reviewSmell === score && styles.ratingButtonTextActive,
                    ]}
                  >
                    {score}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowAdvanced((v) => !v)}>
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? 'Hide details ▲' : 'Add details (optional) ▼'}
          </Text>
        </TouchableOpacity>

        {showAdvanced && (
          <>
            {/* Amenities */}
            <View style={styles.amenitiesContainer}>
              <Text style={styles.subsectionTitle}>Amenities</Text>
              
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>🧻 Toilet Paper</Text>
                <Switch
                  value={hasToiletPaper}
                  onValueChange={setHasToiletPaper}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>
              
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>🚿 Bidet</Text>
                <Switch
                  value={hasBidet}
                  onValueChange={setHasBidet}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>
              
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>🔥 Seat Warmer</Text>
                <Switch
                  value={hasSeatWarmer}
                  onValueChange={setHasSeatWarmer}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>
              
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>🧼 Hand Soap</Text>
                <Switch
                  value={hasHandSoap}
                  onValueChange={setHasHandSoap}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>👶 Baby Changing Table</Text>
                <Switch
                  value={hasBabyChanging}
                  onValueChange={setHasBabyChanging}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>👨‍👩‍👧 Family Room / Nursing Room</Text>
                <Switch
                  value={hasFamilyRoom}
                  onValueChange={setHasFamilyRoom}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>
            </View>

            {/* Physical Details */}
            <View style={styles.detailsContainer}>
              <Text style={styles.subsectionTitle}>Physical Details</Text>
              
              <Text style={styles.label}>Number of Stalls</Text>
              <View style={styles.stallsContainer}>
                {[1, 2, 3, 4].map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.stallButton,
                      numberOfStalls === num && styles.stallButtonActive,
                    ]}
                    onPress={() => setNumberOfStalls(num)}
                  >
                    <Text
                      style={[
                        styles.stallButtonText,
                        numberOfStalls === num && styles.stallButtonTextActive,
                      ]}
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.stallButton,
                    numberOfStalls >= 5 && styles.stallButtonActive,
                  ]}
                  onPress={() => setNumberOfStalls(5)}
                >
                  <Text
                    style={[
                      styles.stallButtonText,
                      numberOfStalls >= 5 && styles.stallButtonTextActive,
                    ]}
                  >
                    4+
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Toilet Type</Text>
              <View style={styles.typeContainer}>
                {(['sit', 'squat', 'both'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeButton,
                      toiletType === type && styles.typeButtonActive,
                    ]}
                    onPress={() => setToiletType(type)}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        toiletType === type && styles.typeButtonTextActive,
                      ]}
                    >
                      {type === 'sit' ? '🚽 Sit' : type === 'squat' ? '🪠 Squat' : 'Both'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>💵 Pay to Enter</Text>
                <Switch
                  value={payToEnter}
                  onValueChange={setPayToEnter}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>

              {payToEnter && (
                <View style={styles.feeContainer}>
                  <Text style={styles.label}>Entry Fee ($)</Text>
                  <TextInput
                    style={styles.input}
                    value={entryFee}
                    onChangeText={setEntryFee}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                </View>
              )}

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>♿ Wheelchair Accessible</Text>
                <Switch
                  value={wheelchairAccessible}
                  onValueChange={setWheelchairAccessible}
                  trackColor={{ false: '#767577', true: '#4CAF50' }}
                />
              </View>
            </View>

            {/* Optional Review Text */}
            <View style={styles.textReviewContainer}>
              <Text style={styles.label}>Review Comment (Optional)</Text>
              <TextInput
                style={styles.textInput}
                value={reviewText}
                onChangeText={setReviewText}
                placeholder="Share your experience..."
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </>
        )}

        </View>
      </ScrollView>

      {/* Sticky submit bar (always reachable) */}
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={submitReview}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Submit Review</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 48, // allow reaching submit button + home indicator
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  backButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#2196F3',
    borderRadius: 8,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  address: {
    fontSize: 16,
    color: '#666',
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  subsectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    marginTop: 10,
  },
  googleRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  googleRating: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4285F4',
    marginRight: 10,
  },
  googleRatingLabel: {
    fontSize: 16,
    color: '#666',
  },
  reviewsContainer: {
    marginTop: 10,
  },
  reviewItem: {
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 10,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reviewAuthor: {
    fontSize: 16,
    fontWeight: '600',
  },
  reviewRating: {
    fontSize: 14,
    color: '#FF9800',
  },
  reviewText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  reviewTime: {
    fontSize: 12,
    color: '#999',
  },
  note: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 10,
  },
  ratingContainer: {
    marginBottom: 30,
  },
  ratingItem: {
    marginBottom: 25,
  },
  ratingLabel: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  ratingButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ratingButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  ratingButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  ratingButtonTextActive: {
    color: '#fff',
  },
  amenitiesContainer: {
    marginBottom: 30,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  switchLabel: {
    fontSize: 16,
  },
  detailsContainer: {
    marginBottom: 30,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 15,
  },
  stallsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  stallButton: {
    flex: 1,
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    alignItems: 'center',
  },
  stallButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  stallButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  stallButtonTextActive: {
    color: '#fff',
  },
  typeContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  typeButton: {
    flex: 1,
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  typeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  feeContainer: {
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  advancedToggle: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  advancedToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  submitButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 0,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  textReviewContainer: {
    marginBottom: 30,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    marginTop: 8,
  },
  ploopReviewItem: {
    padding: 15,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#2196F3',
  },
  ploopReviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  ploopReviewAuthor: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  ploopReviewScores: {
    flexDirection: 'row',
    gap: 10,
  },
  ploopReviewScore: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '600',
  },
  ploopReviewText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    lineHeight: 20,
  },
  ploopReviewTime: {
    fontSize: 12,
    color: '#999',
  },
});

export default LocationReviewScreen;
