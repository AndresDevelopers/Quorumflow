"use client";

import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/contexts/i18n-context";

const BARRIOS = [
  ["libertad", "Libertad"],
  ["guayaquil", "Guayaquil"],
  ["quito", "Quito"],
  ["cuenca", "Cuenca"],
];

const ORGANIZACIONES = [
  ["elderes", "Quórum de Élderes"],
  ["socorro", "Sociedad de Socorro"],
  ["primaria", "Primaria"],
  ["jovenes", "Mujeres Jóvenes"],
];

export default function SeedPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSeed = async () => {
    setLoading(true);
    setStatus(t("admin.seed.seeding"));
    const results: string[] = [];

    try {
      for (const [id, name] of BARRIOS) {
        await setDoc(doc(firestore, "c_barrios", id), { name });
        results.push(`✅ c_barrios/${id}: ${name}`);
      }
      for (const [id, name] of ORGANIZACIONES) {
        await setDoc(doc(firestore, "c_organizaciones", id), { name });
        results.push(`✅ c_organizaciones/${id}: ${name}`);
      }
      setStatus(results.join("\n"));
    } catch (err: any) {
      setStatus("Error: " + err.message);
    }
    setLoading(false);
  };

  return (
    <Card className="max-w-lg mx-auto mt-10">
      <CardHeader>
        <CardTitle>{t("admin.seed.title")}</CardTitle>
        <CardDescription>
          {t("admin.seed.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleSeed} disabled={loading}>
          {loading ? t("admin.seed.seeding") : t("admin.seed.button")}
        </Button>
        {status && (
          <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap">{status}</pre>
        )}
      </CardContent>
    </Card>
  );
}
