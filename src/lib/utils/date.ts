import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";

export const formatDateForInput = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

export const formatDateForDisplay = (date: Date): string => {
  return format(date, 'd MMMM yyyy', { locale: getDateFnsLocale() });
};

export const formatDateTimeForDisplay = (date: Date): string => {
  return format(date, 'd MMMM yyyy, HH:mm', { locale: getDateFnsLocale() });
};
