import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Locale } from '../i18n/translations';

interface LanguagePickerScreenProps {
  onChoose: (locale: Locale) => void;
}

export default function LanguagePickerScreen({ onChoose }: LanguagePickerScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.emoji}>🚽</Text>
      <Text style={styles.title}>Ploop</Text>
      <Text style={styles.prompt}>Choose your language</Text>
      <Text style={styles.promptZh}>选择语言</Text>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => onChoose('en')}
        >
          <Text style={styles.buttonText}>English</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => onChoose('zh')}
        >
          <Text style={styles.buttonText}>中文</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 24,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 24,
  },
  prompt: {
    fontSize: 18,
    color: '#555',
    textAlign: 'center',
    marginBottom: 4,
  },
  promptZh: {
    fontSize: 16,
    color: '#777',
    textAlign: 'center',
    marginBottom: 32,
  },
  buttons: {
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    backgroundColor: '#2196F3',
    borderRadius: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
