import { useEffect } from 'react';
import { supabase } from '../config/supabaseClient'; // Tu configuración actual[cite: 2]

export const useSupabaseRealtime = (table, onUpdate) => {
  useEffect(() => {
    const channel = supabase.channel(`custom-${table}-channel`)
      .on('postgres_changes', { event: '*', schema: 'public', table: table }, (payload) => {
        onUpdate(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, onUpdate]);
};