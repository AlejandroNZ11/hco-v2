// Edge Function: subir-drive
// Sube imágenes a Google Drive usando secretos que solo viven en el servidor.
// El navegador manda la imagen + su sesión de HCO; nunca ve el client_secret ni el refresh_token.
//
// Secretos requeridos (npx supabase secrets set ...):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//   DRIVE_FOLDER_LUP, DRIVE_FOLDER_PRESTAMOS, DRIVE_FOLDER_PERSONAL,
//   DRIVE_FOLDER_VISION (fotos de "No Conforme" del módulo Visión IA / EPP)
// SUPABASE_URL y SUPABASE_ANON_KEY los inyecta Supabase automáticamente.

import { createClient } from "@supabase/supabase-js";

// El navegador NO elige la carpeta: manda un "destino" y aquí se traduce.
const CARPETAS: Record<string, string | undefined> = {
  lup: Deno.env.get("DRIVE_FOLDER_LUP"),
  prestamos: Deno.env.get("DRIVE_FOLDER_PRESTAMOS"),
  personal: Deno.env.get("DRIVE_FOLDER_PERSONAL"),
  vision: Deno.env.get("DRIVE_FOLDER_VISION"),
};

const MAX_BASE64 = 15 * 1024 * 1024; // ~11 MB de imagen

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

let cache = { token: "", expira: 0 };

async function tokenGoogle(): Promise<string> {
  if (cache.token && Date.now() < cache.expira) return cache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "Error obteniendo token de Google");
  }
  cache = { token: data.access_token, expira: Date.now() + 50 * 60 * 1000 };
  return cache.token;
}

// Solo letras, números, punto, guion y guion bajo: evita inyecciones en la query de Drive.
const limpiarNombre = (n: unknown) =>
  String(n ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    // 1. ¿El usuario tiene sesión en HCO?
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "No autorizado" }, 401);

    // 2. Validar lo que llega
    const { imagenBase64, nombreArchivo, destino, anterior, publico = true } = await req.json();

    const folderId = CARPETAS[String(destino)];
    if (!folderId) return json({ error: "Destino inválido" }, 400);

    const img = String(imagenBase64 ?? "");
    if (!img.startsWith("data:image")) return json({ error: "Imagen inválida" }, 400);
    if (img.length > MAX_BASE64) return json({ error: "Imagen demasiado grande" }, 413);

    const nombre = limpiarNombre(nombreArchivo);
    if (!nombre) return json({ error: "Nombre de archivo inválido" }, 400);

    const token = await tokenGoogle();
    const auth = { Authorization: `Bearer ${token}` };

    // 3. (Opcional) qué hacer con un archivo anterior con el mismo nombre
    //    "renombrar" → lo pasa a <nombre>_2.<ext> (fotos de personal)
    //    "borrar"    → lo elimina
    if (anterior === "renombrar" || anterior === "borrar") {
      try {
        const q = `name='${nombre}' and '${folderId}' in parents and trashed=false`;
        const r = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
          { headers: auth },
        );
        const { files = [] } = await r.json();
        const punto = nombre.lastIndexOf(".");
        const nombreViejo = punto > 0
          ? `${nombre.slice(0, punto)}_2${nombre.slice(punto)}`
          : `${nombre}_2`;

        for (const f of files) {
          if (anterior === "borrar") {
            await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
              method: "DELETE",
              headers: auth,
            });
          } else {
            await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
              method: "PATCH",
              headers: { ...auth, "Content-Type": "application/json" },
              body: JSON.stringify({ name: nombreViejo }),
            });
          }
        }
      } catch (e) {
        console.warn("No se pudo procesar el archivo anterior:", e);
      }
    }

    // 4. Subir
    const [cabecera, datos] = img.split(",");
    const mime = cabecera.match(/data:(.*?);/)?.[1] ?? "image/png";
    const bytes = Uint8Array.from(atob(datos), (c) => c.charCodeAt(0));

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify({ name: nombre, mimeType: mime, parents: [folderId] })], {
        type: "application/json",
      }),
    );
    form.append("file", new Blob([bytes], { type: mime }));

    const up = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", headers: auth, body: form },
    );
    const file = await up.json();
    if (!up.ok || !file.id) throw new Error(file?.error?.message || "Error subiendo a Drive");

    // 5. Permiso público de lectura (LUP y préstamos lo usan para mostrar la imagen)
    if (publico) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ role: "reader", type: "anyone" }),
        });
      } catch (e) {
        console.warn("Aviso permiso público:", e);
      }
    }

    return json({ id: file.id, url: `https://drive.google.com/file/d/${file.id}/view` });
  } catch (e) {
    console.error("subir-drive:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
