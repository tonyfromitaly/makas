// Checks the AI key in .env: one understanding call and one chat call against the model.
import { env } from '../config';
import { assistantClient, chatClient } from '../assistant-llm';

if (!env.aiApiKey) {
  console.log('AI_API_KEY boş. .env dosyasına DeepSeek anahtarını yaz ve tekrar dene.');
  process.exit(1);
}
const cfg = { url: env.aiBaseUrl, key: env.aiApiKey, model: env.aiModel };
const today = new Date().toISOString().slice(0, 10);
console.log(`Model: ${env.aiModel} @ ${env.aiBaseUrl}\n`);
try {
  const plan = await assistantClient(cfg)!({
    text: 'bugün 100 dolar kazandım, 300 dolar kira ödedim, 20 dolar bahşiş',
    lang: 'tr', today, weekday: 'Friday', timezone: 'Europe/Istanbul', currency: 'USD',
    services: ['Saç kesimi', 'Sakal tıraşı'], barbers: ['Halil Usta'], clients: ['Ahmet Yılmaz'],
  });
  console.log('Anlama (plan):', JSON.stringify(plan, null, 2));
  const reply = await chatClient(cfg)!({
    question: 'müşterilerim azaldı gibi, ne yapmalıyım?', lang: 'tr', shop: 'Berber Halil', currency: 'USD',
    snapshot: { lapsed_clients_6_weeks: 4, last_60_days: { no_show_rate_pct: 12, no_shows: 5, average_ticket_cents: 3200 } },
  });
  console.log('\nSohbet:', reply);
  console.log('\n✓ Anahtar çalışıyor.');
} catch (e) {
  console.error('✗ Model çağrısı başarısız:', (e as Error).message);
  process.exit(1);
}
