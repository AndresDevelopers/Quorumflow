
"use client";

import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import enTranslations from '@/locales/en.json';
import esTranslations from '@/locales/es.json';
import { setDateFnsLocale } from '@/lib/i18n-date';

const translations: Record<string, Record<string, string>> = {
  en: enTranslations,
  es: esTranslations,
};

/** Tracks missing keys already logged in development to avoid console spam. */
const warnedMissingKeys = new Set<string>();

type Language = "en" | "es";

interface I18nContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>("es");

  useEffect(() => {
    queueMicrotask(() => {
      const savedLang = localStorage.getItem("language") as Language | null;
      if (savedLang) {
        setLanguageState(savedLang);
        return;
      }

      const browserLang = navigator.language.split('-')[0];
      if (browserLang === 'en') {
        setLanguageState('en');
      } else {
        setLanguageState('es'); // Default to Spanish
      }
      setDateFnsLocale(browserLang === 'en' ? 'en' : 'es');
    });
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("language", lang);
    setDateFnsLocale(lang);
  };

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const langKey = language as keyof typeof translations;
      const catalog = translations[langKey];
      let str = catalog?.[key];
      if (str === undefined) {
        if (process.env.NODE_ENV === "development") {
          const warnKey = `${language}:${key}`;
          if (!warnedMissingKeys.has(warnKey)) {
            warnedMissingKeys.add(warnKey);
            console.warn(`[i18n] Missing key "${key}" for language "${language}"`);
          }
        }
        str = key;
      }
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [language]
  );


  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};
