import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { api, CreateToiletData, Toilet } from '../services/api';
import { getErrorMessage, getAddToiletSuccessMessage, hapticSuccess } from '../utils/engagement';
import { useAuth } from '../context/AuthContext';
import { useNavigation, useRoute } from '@react-navigation/native';

const AddToiletScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useAuth();
  const { toiletId } = (route.params as { toiletId?: string }) || {};
  const isEditMode = !!toiletId;
  
  const [loading, setLoading] = useState(false);
  const [loadingToilet, setLoadingToilet] = useState(isEditMode);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [formData, setFormData] = useState<CreateToiletData>({
    name: '',
    address: '',
    latitude: 0,
    longitude: 0,
    has_toilet_paper: false,
    has_bidet: false,
    has_seat_warmer: false,
    has_hand_soap: false,
    has_baby_changing: false,
    has_family_room: false,
    number_of_stalls: 1,
    toilet_type: 'sit',
    pay_to_enter: false,
    entry_fee: undefined,
    wheelchair_accessible: false,
    cleanliness_score: undefined,
    smell_score: undefined,
  });
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [nameSuggestions, setNameSuggestions] = useState<Array<Toilet & { similarity: number; distance?: number }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditMode && toiletId) {
      loadToilet();
    } else {
      // Check if landmark data was passed
      const params = route.params as any;
      if (params?.landmarkName && params?.latitude && params?.longitude) {
        setFormData((prev) => ({
          ...prev,
          name: params.landmarkName,
          address: params.landmarkAddress || '',
          latitude: params.latitude,
          longitude: params.longitude,
        }));
        setLocation({
          coords: {
            latitude: params.latitude,
            longitude: params.longitude,
            altitude: null,
            accuracy: 10,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as Location.LocationObject);
      } else {
        getCurrentLocation();
      }
    }
  }, [toiletId]);

  // Search for name suggestions as user types
  useEffect(() => {
    if (!formData.name || formData.name.length < 2 || isEditMode) {
      setNameSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search (wait 300ms after user stops typing)
    const timeout = setTimeout(async () => {
      if (location && formData.name.length >= 2) {
        try {
          const result = await api.searchNames({
            query: formData.name,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            radius: 2000,
            limit: 5,
          });
          setNameSuggestions(result.suggestions);
          setShowSuggestions(result.suggestions.length > 0);
        } catch (error) {
          console.error('Error searching names:', error);
          // Silently fail - don't show error for autocomplete
        }
      }
    }, 300);

    searchTimeoutRef.current = timeout;

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [formData.name, location]);

  const loadToilet = async () => {
    if (!toiletId) return;
    
    try {
      setLoadingToilet(true);
      const toilet = await api.getToilet(toiletId);
      
      // Populate form with existing data
      setFormData({
        name: toilet.name,
        address: toilet.address || '',
        latitude: toilet.latitude,
        longitude: toilet.longitude,
        has_toilet_paper: toilet.has_toilet_paper,
        has_bidet: toilet.has_bidet,
        has_seat_warmer: toilet.has_seat_warmer,
        has_hand_soap: toilet.has_hand_soap,
        has_baby_changing: toilet.has_baby_changing ?? false,
        has_family_room: toilet.has_family_room ?? false,
        number_of_stalls: toilet.number_of_stalls,
        toilet_type: toilet.toilet_type,
        pay_to_enter: toilet.pay_to_enter,
        entry_fee: toilet.entry_fee,
        wheelchair_accessible: toilet.wheelchair_accessible,
      });

      // Set location from toilet coordinates
      setLocation({
        coords: {
          latitude: toilet.latitude,
          longitude: toilet.longitude,
          altitude: null,
          accuracy: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error loading toilet:', error);
      Alert.alert('Error', 'Failed to load toilet data.');
    } finally {
      setLoadingToilet(false);
    }
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to add a toilet.');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);
      setFormData((prev) => ({
        ...prev,
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      }));
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Failed to get your location.');
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Photo library permission is required.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  const checkDuplicate = async () => {
    if (!formData.name || !location) return false;

    try {
      const duplicateCheck = await api.checkDuplicate({
        latitude: formData.latitude,
        longitude: formData.longitude,
        name: formData.name,
        address: formData.address,
        excludeId: isEditMode ? toiletId : undefined,
      });

      if (duplicateCheck.isDuplicate) {
        Alert.alert(
          'Duplicate Detected',
          duplicateCheck.reason || 'A similar toilet already exists nearby.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'View Existing',
              onPress: () => {
                if (duplicateCheck.duplicateId) {
                  (navigation as any).navigate('ToiletDetails', {
                    toiletId: duplicateCheck.duplicateId,
                  });
                }
              },
            },
            {
              text: isEditMode ? 'Update Anyway' : 'Add Anyway',
              onPress: handleSubmit,
              style: 'destructive',
            },
          ]
        );
        return true;
      }
    } catch (error) {
      console.error('Error checking duplicate:', error);
    }
    return false;
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a toilet name.');
      return;
    }

    if (!location) {
      Alert.alert('Error', 'Location is required. Please enable location services.');
      return;
    }

    setLoading(true);

    try {
      // Check for duplicates first (skip if editing same toilet)
      const isDuplicate = await checkDuplicate();
      if (isDuplicate) {
        setLoading(false);
        return;
      }

      if (isEditMode && toiletId) {
        // Update existing toilet
        await api.updateToilet(toiletId, {
          ...formData,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });

        // Upload photo if provided
        if (photoUri) {
          try {
            await api.uploadPhoto(toiletId, photoUri);
          } catch (error) {
            console.error('Error uploading photo:', error);
            // Don't fail the whole operation if photo upload fails
          }
        }

        await hapticSuccess();
        Alert.alert('Success', 'Toilet updated successfully!', [
          {
            text: 'OK',
            onPress: () => {
              (navigation as any).goBack();
            },
          },
        ]);
      } else {
        // Create new toilet (link to user when signed in)
        const createdToilet = await api.createToilet({
          ...formData,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          created_by: user?.id,
        });

        // Upload photo if provided
        if (photoUri) {
          try {
            await api.uploadPhoto(createdToilet.id, photoUri);
          } catch (error) {
            console.error('Error uploading photo:', error);
            // Don't fail the whole operation if photo upload fails
          }
        }

        await hapticSuccess();
        Alert.alert('Success', getAddToiletSuccessMessage(), [
          {
            text: 'OK',
            onPress: () => {
              (navigation as any).goBack();
            },
          },
        ]);
      }
    } catch (error: any) {
      console.error(`Error ${isEditMode ? 'updating' : 'creating'} toilet:`, error);
      const msg = getErrorMessage(error, `Failed to ${isEditMode ? 'update' : 'add'} toilet. Please try again.`);
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  if (loadingToilet) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.label}>Toilet Name *</Text>
        <View style={styles.nameInputContainer}>
          <TextInput
            style={styles.input}
            value={formData.name}
            onChangeText={(text) => {
              setFormData({ ...formData, name: text });
              setShowSuggestions(text.length >= 2);
            }}
            onFocus={() => {
              if (nameSuggestions.length > 0) setShowSuggestions(true);
            }}
            onBlur={() => {
              // Delay hiding to allow tap on suggestion
              setTimeout(() => setShowSuggestions(false), 200);
            }}
            placeholder="e.g., Starbucks Restroom"
          />
          {showSuggestions && nameSuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {nameSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion.id}
                  style={styles.suggestionItem}
                  onPress={() => {
                    setFormData({ ...formData, name: suggestion.name });
                    setNameSuggestions([]);
                    setShowSuggestions(false);
                  }}
                >
                  <Text style={styles.suggestionName}>{suggestion.name}</Text>
                  {suggestion.address && (
                    <Text style={styles.suggestionAddress}>{suggestion.address}</Text>
                  )}
                  <View style={styles.suggestionMeta}>
                    {suggestion.distance !== undefined && (
                      <Text style={styles.suggestionDistance}>
                        {suggestion.distance}m away
                      </Text>
                    )}
                    <Text style={styles.suggestionSimilarity}>
                      {(suggestion.similarity * 100).toFixed(0)}% match
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.label}>Address (Optional)</Text>
        <TextInput
          style={styles.input}
          value={formData.address}
          onChangeText={(text) => setFormData({ ...formData, address: text })}
          placeholder="Street address"
        />

        <Text style={styles.label}>Number of Stalls</Text>
        <View style={styles.stallsContainer}>
          <TouchableOpacity
            style={[
              styles.stallButton,
              formData.number_of_stalls === 1 && styles.stallButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, number_of_stalls: 1 })}
          >
            <Text>1</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.stallButton,
              formData.number_of_stalls === 2 && styles.stallButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, number_of_stalls: 2 })}
          >
            <Text>2</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.stallButton,
              formData.number_of_stalls === 3 && styles.stallButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, number_of_stalls: 3 })}
          >
            <Text>3</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.stallButton,
              formData.number_of_stalls > 3 && styles.stallButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, number_of_stalls: 4 })}
          >
            <Text>4+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Toilet Type</Text>
        <View style={styles.typeContainer}>
          <TouchableOpacity
            style={[
              styles.typeButton,
              formData.toilet_type === 'sit' && styles.typeButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, toilet_type: 'sit' })}
          >
            <Text>🚽 Sit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.typeButton,
              formData.toilet_type === 'squat' && styles.typeButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, toilet_type: 'squat' })}
          >
            <Text>🪠 Squat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.typeButton,
              formData.toilet_type === 'both' && styles.typeButtonActive,
            ]}
            onPress={() => setFormData({ ...formData, toilet_type: 'both' })}
          >
            <Text>Both</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>🧻 Toilet Paper</Text>
          <Switch
            value={formData.has_toilet_paper}
            onValueChange={(value) =>
              setFormData({ ...formData, has_toilet_paper: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>🧼 Hand Soap</Text>
          <Switch
            value={formData.has_hand_soap}
            onValueChange={(value) =>
              setFormData({ ...formData, has_hand_soap: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>👶 Baby Changing Table</Text>
          <Switch
            value={formData.has_baby_changing ?? false}
            onValueChange={(value) =>
              setFormData({ ...formData, has_baby_changing: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>👨‍👩‍👧 Family Room / Nursing Room</Text>
          <Switch
            value={formData.has_family_room ?? false}
            onValueChange={(value) =>
              setFormData({ ...formData, has_family_room: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>🚿 Bidet</Text>
          <Switch
            value={formData.has_bidet}
            onValueChange={(value) =>
              setFormData({ ...formData, has_bidet: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>🔥 Seat Warmer</Text>
          <Switch
            value={formData.has_seat_warmer}
            onValueChange={(value) =>
              setFormData({ ...formData, has_seat_warmer: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>♿ Wheelchair Accessible</Text>
          <Switch
            value={formData.wheelchair_accessible}
            onValueChange={(value) =>
              setFormData({ ...formData, wheelchair_accessible: value })
            }
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>💰 Pay to Enter</Text>
          <Switch
            value={formData.pay_to_enter}
            onValueChange={(value) =>
              setFormData({ ...formData, pay_to_enter: value })
            }
          />
        </View>

        {formData.pay_to_enter && (
          <View style={styles.feeContainer}>
            <Text style={styles.label}>Entry Fee</Text>
            <TextInput
              style={styles.input}
              value={formData.entry_fee?.toString() || ''}
              onChangeText={(text) =>
                setFormData({
                  ...formData,
                  entry_fee: text ? parseFloat(text) : undefined,
                })
              }
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </View>
        )}

        <Text style={styles.label}>Initial Scores (Optional)</Text>
        <View style={styles.scoreContainer}>
          <View style={styles.scoreInput}>
            <Text style={styles.scoreLabel}>Cleanliness (1-5)</Text>
            <TextInput
              style={styles.scoreTextInput}
              value={formData.cleanliness_score?.toString() || ''}
              onChangeText={(text) =>
                setFormData({
                  ...formData,
                  cleanliness_score: text ? parseInt(text) : undefined,
                })
              }
              placeholder="0"
              keyboardType="number-pad"
              maxLength={1}
            />
          </View>
          <View style={styles.scoreInput}>
            <Text style={styles.scoreLabel}>Smell (1-5)</Text>
            <TextInput
              style={styles.scoreTextInput}
              value={formData.smell_score?.toString() || ''}
              onChangeText={(text) =>
                setFormData({
                  ...formData,
                  smell_score: text ? parseInt(text) : undefined,
                })
              }
              placeholder="0"
              keyboardType="number-pad"
              maxLength={1}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
          <Text style={styles.photoButtonText}>
            {photoUri ? '📷 Photo Selected' : '📷 Add Photo (Optional)'}
          </Text>
        </TouchableOpacity>

        {location && (
          <Text style={styles.locationText}>
            📍 Location: {location.coords.latitude.toFixed(6)},{' '}
            {location.coords.longitude.toFixed(6)}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>
              {isEditMode ? 'Update Toilet' : 'Add Toilet'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
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
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  form: {
    padding: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 16,
  },
  nameInputContainer: {
    position: 'relative',
    zIndex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  suggestionAddress: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  suggestionMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  suggestionDistance: {
    fontSize: 11,
    color: '#2196F3',
  },
  suggestionSimilarity: {
    fontSize: 11,
    color: '#4CAF50',
    fontWeight: '600',
  },
  stallsContainer: {
    flexDirection: 'row',
    gap: 10,
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
  typeContainer: {
    flexDirection: 'row',
    gap: 10,
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
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  switchLabel: {
    fontSize: 16,
  },
  feeContainer: {
    marginTop: 10,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  scoreInput: {
    flex: 1,
  },
  scoreLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  scoreTextInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  photoButton: {
    backgroundColor: '#f0f0f0',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  photoButtonText: {
    fontSize: 16,
    color: '#2196F3',
  },
  locationText: {
    fontSize: 12,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default AddToiletScreen;

