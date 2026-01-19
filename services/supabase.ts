import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gyiqdkmvlixwgedjhycc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_psIWS8xZmx4aCqVnzUFkyg_vjM1kPiz';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const uploadMediaToSupabase = async (blob: Blob, path: string) => {
    const { data, error } = await supabase.storage
        .from('media')
        .upload(path, blob, {
            cacheControl: '3600',
            upsert: true
        });

    if (error) {
        throw error;
    }

    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(path);
    return publicUrl;
};