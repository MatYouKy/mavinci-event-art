module.exports = {
  apps: [
    {
      name: "fordj-frontend",
      script: "/var/www/fordj/frontend/.next/standalone/server.js",
      cwd: "/var/www/fordj/frontend/.next/standalone",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
        NEXT_PUBLIC_SUPABASE_URL: 'https://fuuljhhuhfojtmmfmskq.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dWxqaGh1aGZvanRtbWZtc2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NDI5NjEsImV4cCI6MjA3NTUxODk2MX0.xe8_YUgENMeXwuLSZVatAfDBZLi5lcfyV3sHjaD8dmE',
        SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dWxqaGh1aGZvanRtbWZtc2txIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTk0Mjk2MSwiZXhwIjoyMDc1NTE4OTYxfQ.7GsfkMVGGIMvBR9Sd_iPg0BsjG7jHzPuC5ZZQ7VIV08',
        
      },
    },
  ],
};