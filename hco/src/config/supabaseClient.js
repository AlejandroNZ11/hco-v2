import { createClient } from '@supabase/supabase-js';

// Vite expone las variables de entorno a través de import.meta.env
// .trim(): si la variable del hosting (Cloudflare) trae un salto de línea o espacio al final,
// la clave viaja como "...%0A" en la URL del WebSocket y Supabase rechaza el tiempo real.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const supabase = createClient(supabaseUrl, supabaseKey);
