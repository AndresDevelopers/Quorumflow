
"use client";

import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import enTranslations from '@/locales/en.json';
import esTranslations from '@/locales/es.json';
import { setDateFnsLocale } from '@/lib/i18n-date';

const translations: Record<string, Record<string, string>> = {
  en: enTranslations,
  es: esTranslations,
};

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
      let str = translations[langKey]?.[key] || key;
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
