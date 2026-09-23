import { createClient } from '@supabase/supabase-js';

// Reemplaza esto con tu Project URL de Supabase
const supabaseUrl = 'https://snzmglvicniapxizcdos.supabase.co';

// Reemplaza esto con tu anon (public) key de Supabase
const supabaseKey = 'sb_publishable_h2LPyMnmu20YGxs_6TCOHA_3hOc2JGC'; 

export const supabase = createClient(supabaseUrl, supabaseKey);