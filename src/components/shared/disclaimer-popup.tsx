"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/i18n-context";

const DISCLAIMER_STORAGE_KEY = "quroumflow_disclaimer_dismissed_until";

interface DisclaimerPopupProps {
  /** If true, dismissal persists for 31 days. If false, popup re-appears on every page visit. */
  persistent?: boolean;
}

export function DisclaimerPopup({ persistent = false }: DisclaimerPopupProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (persistent) {
      const dismissedUntil = localStorage.getItem(DISCLAIMER_STORAGE_KEY);
      if (dismissedUntil) {
        const expiryDate = new Date(dismissedUntil);
        if (expiryDate > new Date()) {
          setOpen(false);
          return;
        }
        // Expired — clean up
        localStorage.removeItem(DISCLAIMER_STORAGE_KEY);
      }
      setOpen(true);
    } else {
      // Non-persistent: always show
      setOpen(true);
    }
  }, [persistent]);

  const handleClose = () => {
    setOpen(false);
    if (persistent) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 31);
      localStorage.setItem(DISCLAIMER_STORAGE_KEY, expiry.toISOString());
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("disclaimer.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("disclaimer.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={handleClose} variant="default">
            {t("disclaimer.dismiss")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
