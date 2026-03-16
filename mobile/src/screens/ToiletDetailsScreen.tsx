import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  Modal,
  Share,
  Pressable,
} from 'react-native';
// Optional: in Expo Go, react-native-maps may be missing (RNMapsAirModule); screen must still load.
let MapView: any = null;
let Marker: any = null;
let PROVIDER_GOOGLE: any = null;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch {
  // Maps unavailable (e.g. Expo Go); map section will be hidden.
}
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { api, Toilet, ToiletReview } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useRoute, useNavigation } from '@react-navigation/native';
import { getReviewSuccessMessage, hapticSuccess, getErrorMessage } from '../utils/engagement';
import { playFlushSound } from '../utils/flushSound';
import { openInMapsWithChoice } from '../utils/maps';

function formatServicedAgo(iso: string, t: (k: string) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return `${mins}${t('minutesAgo')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${t('hoursAgo')}`;
  const days = Math.floor(hrs / 24);
  return `${days}${t('daysAgo')}`;
}

const SOS_OPTIONS = [
  { id: 'toilet_paper', label: 'Toilet paper', emoji: '🧻', messageText: 'I need toilet paper' },
  { id: 'no_soap', label: 'No soap', emoji: '🧼', messageText: "There's no soap" },
  { id: 'flush', label: 'Flush not working', emoji: '🚿', messageText: "The flush isn't working" },
  { id: 'clog', label: 'Clogged', emoji: '🪠', messageText: 'The toilet is clogged' },
  { id: 'broken_tap', label: 'Broken tap', emoji: '🚰', messageText: 'The tap is broken' },
] as const;

const ToiletDetailsScreen: React.FC = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toiletId } = (route.params as { toiletId?: string }) || {};
  const [toilet, setToilet] = useState<Toilet | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ToiletReview[]>([]);
  const [myReview, setMyReview] = useState<ToiletReview | null>(null);
  const [reviewCleanliness, setReviewCleanliness] = useState<number | null>(null);
  const [reviewSmell, setReviewSmell] = useState<number | null>(null);
  const [nearbyToilets, setNearbyToilets] = useState<Toilet[]>([]);
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editCleanliness, setEditCleanliness] = useState<number | null>(null);
  const [editSmell, setEditSmell] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sosModalOpen, setSosModalOpen] = useState(false);
  const [markingServiced, setMarkingServiced] = useState(false);

  useEffect(() => {
    if (!toiletId) return;
    loadToilet();
  }, [toiletId]);

  useEffect(() => {
    if (user) loadToilet();
  }, [user?.id]);

const loadToilet = async () => {
    if (!toiletId) {
      setLoading(false);
      return;
    }
    try {
      const [data, reviewsRes] = await Promise.all([
        api.getToilet(toiletId),
        api.getToiletReviews(toiletId).catch(() => ({ reviews: [] })),
      ]);
      setToilet(data);
      setReviews(reviewsRes.reviews || []);
      const mine = user && reviewsRes.reviews?.find((r: ToiletReview) => r.user_id === user.id);
      setMyReview(mine || null);

      // Get user location and nearby toilets for map
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({});
          setUserLocation(location);

          // Fetch nearby toilets
          const { toilets } = await api.getNearbyToilets({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            radius: 1000,
            limit: 20,
          });
          setNearbyToilets(Array.isArray(toilets) ? toilets : []);
        }
      } catch (locationError) {
        console.error('Error getting location:', locationError);
        // Continue without location - map will still show toilet location
      }
    } catch (error: any) {
      console.error('Error loading toilet:', error);
      const msg = getErrorMessage(error, 'Failed to load toilet details.');
      if (error?.response?.status === 404) {
        Alert.alert('Not found', 'This toilet may have been removed.', [
          { text: 'OK', onPress: () => (navigation as any).goBack() },
        ]);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const startEditReview = (review: ToiletReview) => {
    setEditingReviewId(review.id);
    setEditCleanliness(review.cleanliness_score ?? null);
    setEditSmell(review.smell_score ?? null);
    setEditText(review.review_text || '');
  };

  const saveEditReview = async () => {
    if (!toiletId || !editingReviewId || (!editCleanliness && !editSmell)) return;
    setSubmitting(true);
    try {
      await api.updateReview(toiletId, editingReviewId, {
        cleanliness_score: editCleanliness ?? undefined,
        smell_score: editSmell ?? undefined,
        review_text: editText.trim() || undefined,
      });
      setEditingReviewId(null);
      loadToilet();
    } catch (e: any) {
      Alert.alert('Error', getErrorMessage(e, 'Failed to update review.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkServiced = async () => {
    if (!toiletId || !user) return;
    setMarkingServiced(true);
    try {
      await api.markServiced(toiletId);
      hapticSuccess();
      loadToilet();
    } catch (e: any) {
      Alert.alert('Error', getErrorMessage(e, 'Failed to update. Sign in and try again.'));
    } finally {
      setMarkingServiced(false);
    }
  };

  const deleteMyReview = () => {
    if (!toiletId || !myReview) return;
    Alert.alert(
      'Delete review',
      'Remove your review for this toilet?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteReview(toiletId, myReview.id);
              setMyReview(null);
              loadToilet();
            } catch (e: any) {
              Alert.alert('Error', getErrorMessage(e, 'Failed to delete review.'));
            }
          },
        },
      ]
    );
  };

  const shareSosWithFriend = async (needId: string) => {
    if (!toilet) return;
    const option = SOS_OPTIONS.find((o) => o.id === needId);
    const situationText = option?.messageText ?? option?.label ?? needId;
    // Prefer sender's current GPS for accuracy; fall back to toilet location
    let lat = toilet.latitude;
    let lng = toilet.longitude;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
    } catch {
      // Use toilet coords
    }
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const location = toilet.address || toilet.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const message = `Please help! ${situationText} at ${toilet.name}, ${location}. My location: ${mapsUrl}`;
    try {
      await Share.share({
        message,
        title: 'Ploop SOS – Need help',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      api.track('sos_shared', { toiletId: toilet.id, needType: needId });
      setSosModalOpen(false);
    } catch {
      // User cancelled or share failed – ignore
    }
  };

  const formatScore = (score: number | string | null | undefined): string => {
    if (score === null || score === undefined) return 'N/A';
    const numScore = typeof score === 'string' ? parseFloat(score) : score;
    if (isNaN(numScore)) return 'N/A';
    return numScore.toFixed(1);
  };

  const submitReview = async () => {
    if (!toiletId) return;
    if (!reviewCleanliness && !reviewSmell) {
      Alert.alert('Error', 'Please rate at least one aspect.');
      return;
    }

    try {
      await api.addReview(toiletId, {
        cleanliness_score: reviewCleanliness || undefined,
        smell_score: reviewSmell || undefined,
      });
      await api.bumpLocalMetric('reviews', 1);
      const { reviews } = await api.getLocalMetrics();
      const message = getReviewSuccessMessage(reviews);
      await hapticSuccess();
      playFlushSound();
      Alert.alert('Success', message);
      setReviewCleanliness(null);
      setReviewSmell(null);
      loadToilet(); // Reload to get updated scores
    } catch (error: any) {
      console.error('Error submitting review:', error);
      Alert.alert('Error', getErrorMessage(error, 'Failed to submit review.'));
    }
  };

  if (!toiletId) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Missing toilet. Going back.</Text>
        <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.cancelEditButton}>
          <Text style={styles.cancelEditButtonText}>Back</Text>
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

  if (!toilet) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Toilet not found. It may have been removed.</Text>
        <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.cancelEditButton}>
          <Text style={styles.cancelEditButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{toilet.name}</Text>
        {toilet.address && <Text style={styles.address}>{toilet.address}</Text>}
        <TouchableOpacity
          style={styles.sosButton}
          onPress={() => setSosModalOpen(true)}
          accessibilityLabel="Need help? Notify a friend"
          accessibilityRole="button"
        >
          <Text style={styles.sosButtonEmoji}>🆘</Text>
          <Text style={styles.sosButtonText}>Need help? Notify a friend</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={sosModalOpen} transparent animationType="fade" onRequestClose={() => setSosModalOpen(false)}>
        <Pressable style={styles.sosBackdrop} onPress={() => setSosModalOpen(false)} />
        <View style={styles.sosModalContent}>
          <View style={styles.sosModalInner}>
            <Text style={styles.sosModalTitle}>What do you need?</Text>
            <Text style={styles.sosModalSubtitle}>Share with a friend so they can help</Text>
            {SOS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={styles.sosOption}
                onPress={() => shareSosWithFriend(opt.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.sosOptionEmoji}>{opt.emoji}</Text>
                <Text style={styles.sosOptionLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.sosCancel} onPress={() => setSosModalOpen(false)}>
              <Text style={styles.sosCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {toilet.last_serviced_at && (
        <View style={styles.servicedBadge}>
          <Text style={styles.servicedBadgeText}>
            ✨ {t('lastServiced')} {formatServicedAgo(toilet.last_serviced_at, t)}
          </Text>
        </View>
      )}
      {user && (
        <View style={styles.businessSection}>
          <TouchableOpacity
            style={[styles.markServicedBtn, markingServiced && styles.markServicedBtnDisabled]}
            onPress={handleMarkServiced}
            disabled={markingServiced}
          >
            {markingServiced ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.markServicedBtnText}>{t('justCleaned')}</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.businessHint}>{t('forStaffHint')}</Text>
        </View>
      )}
      {(toilet.total_reviews ?? 0) === 0 && (
        <View style={styles.importedHintBanner}>
          <Text style={styles.importedHintText}>{t('importedNoReviewsHint')}</Text>
        </View>
      )}
      <View style={styles.scoresSection}>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>{t('cleanliness')}</Text>
          <Text style={styles.scoreValue}>
            {formatScore(toilet.cleanliness_score)}/5
          </Text>
          <Text style={styles.reviewCount}>
            {toilet.total_reviews} {t('reviews')}
          </Text>
        </View>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>{t('smell')}</Text>
          <Text style={styles.scoreValue}>
            {formatScore(toilet.smell_score)}/5
          </Text>
          <Text style={styles.reviewCount}>
            {toilet.total_reviews} {t('reviews')}
          </Text>
        </View>
      </View>

      {user && myReview && !editingReviewId && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('yourReview')}</Text>
          <View style={styles.myReviewCard}>
            <Text style={styles.myReviewScores}>
              Cleanliness {formatScore(myReview.cleanliness_score)}/5 · Smell {formatScore(myReview.smell_score)}/5
            </Text>
            {myReview.review_text ? (
              <Text style={styles.myReviewText}>{myReview.review_text}</Text>
            ) : null}
            <View style={styles.myReviewActions}>
              <TouchableOpacity style={styles.editReviewButton} onPress={() => startEditReview(myReview)}>
                <Text style={styles.editReviewButtonText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteReviewButton} onPress={deleteMyReview}>
                <Text style={styles.deleteReviewButtonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {editingReviewId && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Edit your review</Text>
          <View style={styles.ratingContainer}>
            <View style={styles.ratingItem}>
              <Text style={styles.ratingLabel}>Cleanliness</Text>
              <View style={styles.ratingButtons}>
                {[1, 2, 3, 4, 5].map((score) => (
                  <TouchableOpacity
                    key={score}
                    style={[styles.ratingButton, editCleanliness === score && styles.ratingButtonActive]}
                    onPress={() => setEditCleanliness(score)}
                  >
                    <Text>{score}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.ratingItem}>
              <Text style={styles.ratingLabel}>Smell</Text>
              <View style={styles.ratingButtons}>
                {[1, 2, 3, 4, 5].map((score) => (
                  <TouchableOpacity
                    key={score}
                    style={[styles.ratingButton, editSmell === score && styles.ratingButtonActive]}
                    onPress={() => setEditSmell(score)}
                  >
                    <Text>{score}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TextInput
              style={styles.editReviewTextInput}
              placeholder="Optional comment"
              value={editText}
              onChangeText={setEditText}
              multiline
            />
          </View>
          <View style={styles.editReviewActions}>
            <TouchableOpacity
              style={styles.cancelEditButton}
              onPress={() => setEditingReviewId(null)}
              disabled={submitting}
            >
              <Text style={styles.cancelEditButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveEditButton}
              onPress={saveEditReview}
              disabled={submitting || (!editCleanliness && !editSmell)}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveEditButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('amenities')}</Text>
        <View style={styles.amenitiesGrid}>
          {toilet.has_toilet_paper && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>🧻</Text>
              <Text style={styles.amenityText}>Toilet Paper</Text>
            </View>
          )}
          {toilet.has_hand_soap && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>🧼</Text>
              <Text style={styles.amenityText}>Hand Soap</Text>
            </View>
          )}
          {toilet.has_baby_changing && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>👶</Text>
              <Text style={styles.amenityText}>Baby Changing Table</Text>
            </View>
          )}
          {toilet.has_family_room && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>👨‍👩‍👧</Text>
              <Text style={styles.amenityText}>Family Room / Nursing Room</Text>
            </View>
          )}
          {toilet.has_bidet && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>🚿</Text>
              <Text style={styles.amenityText}>Bidet</Text>
            </View>
          )}
          {toilet.has_seat_warmer && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>🔥</Text>
              <Text style={styles.amenityText}>Seat Warmer</Text>
            </View>
          )}
          {toilet.wheelchair_accessible && (
            <View style={styles.amenityItem}>
              <Text style={styles.amenityIcon}>♿</Text>
              <Text style={styles.amenityText}>Wheelchair Accessible</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Number of Stalls:</Text>
          <Text style={styles.detailValue}>{toilet.number_of_stalls}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Type:</Text>
          <Text style={styles.detailValue}>
            {toilet.toilet_type === 'sit' ? '🚽 Sit' : toilet.toilet_type === 'squat' ? '🪠 Squat' : 'Both'}
          </Text>
        </View>
        {toilet.pay_to_enter && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Entry Fee:</Text>
            <Text style={styles.detailValue}>
              ${toilet.entry_fee?.toFixed(2) || '0.00'}
            </Text>
          </View>
        )}
      </View>

      {toilet.photos && toilet.photos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {toilet.photos.map((photo: any) => (
              <Image
                key={photo.id}
                source={{ uri: photo.photo_url }}
                style={styles.photo}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.mapHeader}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => toilet && openInMapsWithChoice(toilet.latitude, toilet.longitude, toilet.name)}
              style={styles.mapToggle}
            >
              <Text style={styles.mapToggleText}>Open in Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowMap(!showMap)}
              style={styles.mapToggle}
            >
              <Text style={styles.mapToggleText}>
                {showMap ? 'Hide Map' : 'Show Map'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        {showMap && MapView && Marker && PROVIDER_GOOGLE && (
          <View style={styles.mapContainer}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={{
                latitude: toilet.latitude,
                longitude: toilet.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              showsUserLocation={!!userLocation}
              showsMyLocationButton={false}
            >
              {/* Main toilet marker */}
              <Marker
                coordinate={{
                  latitude: toilet.latitude,
                  longitude: toilet.longitude,
                }}
                title={toilet.name}
                description={toilet.address}
                tracksViewChanges={false}
              >
                <View style={styles.mapMarkerContainer}>
                  <Text style={styles.mapMarkerEmoji}>🚽</Text>
                  <View style={[styles.mapMarkerBadge, { backgroundColor: '#2196F3' }]}>
                    <View style={styles.mapMarkerBadgeInner} />
                  </View>
                </View>
              </Marker>
              
              {/* Nearby toilets */}
              {(nearbyToilets ?? [])
                .filter((t) => t.id !== toilet.id)
                .map((nearbyToilet) => (
                  <Marker
                    key={nearbyToilet.id}
                    coordinate={{
                      latitude: nearbyToilet.latitude,
                      longitude: nearbyToilet.longitude,
                    }}
                    title={nearbyToilet.name}
                    tracksViewChanges={false}
                    onPress={() => {
                      try {
                        (navigation as any).navigate('ToiletDetails', {
                          toiletId: nearbyToilet.id,
                        });
                      } catch (error) {
                        console.error('Error navigating to toilet:', error);
                      }
                    }}
                  >
                    <View style={styles.mapMarkerContainer}>
                      <Text style={styles.mapMarkerEmoji}>🚽</Text>
                      <View style={[styles.mapMarkerBadge, { backgroundColor: '#999' }]}>
                        <View style={styles.mapMarkerBadgeInner} />
                      </View>
                    </View>
                  </Marker>
                ))}
            </MapView>
            <TouchableOpacity
              style={styles.backToMapButton}
              onPress={() => {
                (navigation as any).navigate('Map');
              }}
            >
              <Text style={styles.backToMapButtonText}>View on Main Map</Text>
            </TouchableOpacity>
          </View>
        )}
        {!showMap && (
          <TouchableOpacity
            style={styles.showMapButton}
            onPress={() => setShowMap(true)}
            disabled={!MapView}
          >
            <Text style={styles.showMapButtonText}>
              {MapView ? '📍 Show on Map' : '📍 Map unavailable (use dev build for full map)'}
            </Text>
          </TouchableOpacity>
        )}
        {showMap && !MapView && (
          <View style={styles.mapContainer}>
            <Text style={{ color: '#94a3b8', textAlign: 'center', padding: 16 }}>
              Map unavailable in this build. Run npx expo run:ios for the full map.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rate This Toilet</Text>
        <View style={styles.ratingContainer}>
          <View style={styles.ratingItem}>
            <Text style={styles.ratingLabel}>Cleanliness</Text>
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
                  <Text>{score}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.ratingItem}>
            <Text style={styles.ratingLabel}>Smell</Text>
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
                  <Text>{score}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.submitReviewButton} onPress={submitReview}>
          <Text style={styles.submitReviewButtonText}>Submit Review</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.editButton}
        onPress={() => {
          (navigation as any).navigate('EditToilet', { toiletId: toilet.id });
        }}
      >
        <Text style={styles.editButtonText}>Edit Toilet</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
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
    fontSize: 14,
    color: '#666',
  },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  sosButtonEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  sosButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#92400e',
  },
  sosBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sosModalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sosModalInner: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  sosModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#111',
  },
  sosModalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  sosOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sosOptionEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  sosOptionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#334155',
  },
  sosCancel: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sosCancelText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  servicedBadge: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#ecfdf5',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  servicedBadgeText: {
    fontSize: 14,
    color: '#047857',
    fontWeight: '600',
  },
  importedHintBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  importedHintText: {
    fontSize: 14,
    color: '#92400e',
    lineHeight: 20,
  },
  businessSection: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  markServicedBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  markServicedBtnDisabled: {
    opacity: 0.7,
  },
  markServicedBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  businessHint: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
    textAlign: 'center',
  },
  scoresSection: {
    flexDirection: 'row',
    padding: 20,
    gap: 10,
  },
  scoreCard: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  reviewCount: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  amenitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
  },
  amenityItem: {
    alignItems: 'center',
    width: '30%',
  },
  amenityIcon: {
    fontSize: 32,
    marginBottom: 5,
  },
  amenityText: {
    fontSize: 12,
    textAlign: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  detailLabel: {
    fontSize: 16,
    color: '#666',
  },
  detailValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  photo: {
    width: 200,
    height: 200,
    borderRadius: 10,
    marginRight: 10,
  },
  ratingContainer: {
    marginBottom: 20,
  },
  ratingItem: {
    marginBottom: 15,
  },
  ratingLabel: {
    fontSize: 16,
    marginBottom: 10,
  },
  ratingButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  ratingButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  submitReviewButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitReviewButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  editButton: {
    backgroundColor: '#FF9800',
    padding: 15,
    margin: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  mapToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
  },
  mapToggleText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: '600',
  },
  mapContainer: {
    height: 250,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 10,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  showMapButton: {
    padding: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  showMapButtonText: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: '600',
  },
  backToMapButton: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  backToMapButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  mapMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapMarkerEmoji: {
    fontSize: 32,
    textAlign: 'center',
  },
  mapMarkerBadge: {
    position: 'absolute',
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  mapMarkerBadgeInner: {
    flex: 1,
    borderRadius: 4,
  },
  myReviewCard: {
    backgroundColor: '#f0f9ff',
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  myReviewScores: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0369a1',
    marginBottom: 6,
  },
  myReviewText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
  },
  myReviewActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editReviewButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  editReviewButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteReviewButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#f44336',
    borderRadius: 8,
  },
  deleteReviewButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  editReviewTextInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    marginBottom: 12,
  },
  editReviewActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelEditButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
  },
  cancelEditButtonText: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '600',
  },
  saveEditButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#2196F3',
    alignItems: 'center',
  },
  saveEditButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});

export default ToiletDetailsScreen;

