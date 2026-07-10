"use client";

import { Phone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Strips non-digit characters from a phone number for tel: links.
 */
function stripPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Formats a phone number for WhatsApp API:
 * Removes non-digits and prepends country code if missing.
 * Defaults to +593 (Ecuador) when the number has less than 10 digits and no "+" prefix.
 */
function toWhatsAppNumber(phone: string): string {
  const cleaned = stripPhone(phone);
  if (cleaned.length >= 10) return cleaned;
  if (phone.startsWith("+")) return cleaned;
  return "593" + cleaned.replace(/^0+/, "");
}

export interface ContactLinkProps {
  value: string;
  className?: string;
}

export function PhoneLink({ value, className }: ContactLinkProps) {
  const clean = stripPhone(value);
  const waNumber = toWhatsAppNumber(value);

  return (
    <div className={cn("flex items-center gap-2 text-muted-foreground", className)}>
      <Phone className="h-3.5 w-3.5 shrink-0" />
      <div className="flex items-center gap-2">
        <a
          href={`tel:${clean}`}
          className="text-sm text-primary hover:underline hover:text-primary/80 transition-colors"
          aria-label={`Llamar al ${value}`}
        >
          {value}
        </a>
        <a
          href={`https://wa.me/${waNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
          aria-label={`Abrir WhatsApp con ${value}`}
          title="WhatsApp"
        >
          WhatsApp
        </a>
      </div>
    </div>
  );
}

export function AddressLink({ value, className }: ContactLinkProps) {
  const encoded = encodeURIComponent(value);

  return (
    <div className={cn("flex items-start gap-2 text-muted-foreground", className)}>
      <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <a
        href={`https://www.google.com/maps/search/${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary hover:underline hover:text-primary/80 transition-colors"
        aria-label={`Ver dirección en Google Maps: ${value}`}
      >
        {value}
      </a>
    </div>
  );
}
