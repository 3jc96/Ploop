import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { translations, type Locale } from '../i18n/translations';

const STORAGE_KEY = 'ploop.locale';
const LOCALE_FILE = 'ploop_locale.txt';

export type LocaleStatus = 'loading' | 'needsPick' | 'ready';

interface LanguageContextValue {
  locale: Locale;
  localeStatus: LocaleStatus;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [status, setStatus] = useState<LocaleStatus>('ready');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(async (s) => {
      if (s === 'zh' || s === 'en') {
        setLocaleState(s);
        try {
          const dir = FileSystem.documentDirectory;
          if (dir) await FileSystem.writeAsStringAsync(dir + LOCALE_FILE, s);
        } catch {
          // ignore
        }
      } else {
        setStatus('needsPick');
      }
    });
  }, []);

  const setLocale = useCallback(async (l: Locale) => {
    setLocaleState(l);
    setStatus('ready');
    await AsyncStorage.setItem(STORAGE_KEY, l);
    // Write to file so native layer can apply locale for map labels (requires app restart)
    try {
      const dir = FileSystem.documentDirectory;
      if (dir) await FileSystem.writeAsStringAsync(dir + LOCALE_FILE, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string): string => {
      const dict = translations[locale];
      return dict[key] ?? translations.en[key] ?? key;
    },
    [locale]
  );

  return (
    <LanguageContext.Provider value={{ locale, localeStatus: status, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
