import { es, enUS, type Locale } from "date-fns/locale";

let currentLocale: Locale = es;

export const setDateFnsLocale = (language: "en" | "es"): void => {
  currentLocale = language === "en" ? enUS : es;
};

export const getDateFnsLocale = (): Locale => currentLocale;
