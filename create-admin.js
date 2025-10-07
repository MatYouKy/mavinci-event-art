import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

async function createAdmin() {
  const email = process.argv[2] || 'admin@test.com';
  const password = process.argv[3] || 'admin123';

  console.log('\n=== Tworzenie konta administratora ===\n');

  if (password.length < 6) {
    console.error('❌ Hasło musi mieć minimum 6 znaków!');
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Brak konfiguracji Supabase w pliku .env');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  console.log('⏳ Tworzenie użytkownika...');
  console.log('Email:', email);

  const { data, error } = await supabase.auth.signUp({
    email: email,
    password: password,
  });

  if (error) {
    console.error('❌ Błąd:', error.message);
  } else {
    console.log('\n✅ Konto utworzone pomyślnie!');
    console.log('\n📧 Dane do logowania:');
    console.log('Email:', email);
    console.log('Hasło:', password);
    console.log('\n💡 Możesz się teraz zalogować klikając przycisk "Admin" w nawigacji.');
    console.log('💡 Strona logowania: /admin/login');
  }
}

createAdmin().catch(console.error);
