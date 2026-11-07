// Supabase configuration
// This will be initialized in the Next.js app with environment variables

// Environment variables needed:
// NEXT_PUBLIC_SUPABASE_URL
// NEXT_PUBLIC_SUPABASE_ANON_KEY
// SUPABASE_SERVICE_ROLE_KEY

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

// Helper to get current user with role
export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { user} } = await supabase.auth.getUser();
  return user;
}

// Helper to get user's organization and role
export async function getUserProfile() {
  if (!supabase) return null;
  const { data: { user} } = await supabase.auth.getUser();
  if (!user) return null;
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  
  return { user, profile: data };
}
