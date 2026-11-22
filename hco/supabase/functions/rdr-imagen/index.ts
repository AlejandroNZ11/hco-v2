// Edge Function: rdr-imagen
// Descarga una foto desde su URL (Google Drive, SharePoint público, etc.) y la devuelve en base64.
// Se usa como respaldo cuando el navegador no puede leer la imagen directamente (bloqueo CORS)
// al armar los Excel de RDR. Solo atiende a usuarios con sesión de HCO y solo devuelve imágenes.
//
// Despliegue: npx supabase functions deploy rdr-imagen

import { createClient } from "@supabase/supabase-js";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB por foto

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

// Bloquea direcciones internas para que la función no sirva de puente a la red privada
const hostPermitido = (host: string) => {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.startsWith("[")) return false; // IPv6 literal
  return true;
};

// Convierte enlaces de Google Drive a descarga directa
const urlDescarga = (url: string) => {
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m && /drive\.google\.com|docs\.google\.com/.test(url)) {
    return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }
  return url;
};

const aBase64 = (bytes: Uint8Array) => {
  let binario = "";
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloque));
  }
  return btoa(binario);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // Validar sesión de HCO
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Sesión no válida" }, 401);

  try {
    const { url } = await req.json();
    let destino: URL;
    try {
      destino = new URL(urlDescarga(String(url ?? "").trim()));
    } catch {
      return json({ error: "URL inválida" }, 400);
    }
    if (!["http:", "https:"].includes(destino.protocol) || !hostPermitido(destino.hostname)) {
      return json({ error: "URL no permitida" }, 400);
    }

    const res = await fetch(destino.toString(), { redirect: "follow" });
    if (!res.ok) return json({ error: `La foto respondió ${res.status}` }, 502);

    const tipo = res.headers.get("content-type") ?? "";
    if (!tipo.startsWith("image/")) return json({ error: "El enlace no es una imagen" }, 415);

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return json({ error: "La foto supera 12 MB" }, 413);

    return json({ base64: aBase64(bytes), contentType: tipo });
  } catch (e) {
    return json({ error: (e as Error).message || "Error descargando la foto" }, 500);
  }
});
