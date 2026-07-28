import { config } from 'dotenv'

// `dotenv/config` le `.env`; o arquivo do projeto e `.env.local`, entao o
// caminho tem que ser explicito ou SUPABASE_DB_URL e a anon key ficam vazias.
config({ path: '.env.local' })
