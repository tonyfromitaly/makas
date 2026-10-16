import type { AssistantInput, Deps } from '@makas/core';

// The model only turns a sentence into a JSON plan. It never sees the shop's money,
// never computes a total and never writes: the API validates the plan, resolves names,
// answers questions with SQL and the barber confirms every write.
const SYSTEM = `You are the understanding layer of Makas, a barber shop app. Convert the barber's message into JSON.
Output ONLY {"items":[...]} where each item is one of:
- {"type":"appointment","client_name":string|null,"phone":string|null,"service":string|null,"barber":string|null,"date":"YYYY-MM-DD","time":"HH:MM"|null}
- {"type":"client","name":string,"phone":string|null,"language":"tr"|"en"|"es"|null}   (registering a new client)
- {"type":"book","kind":"income"|"expense","amount_cents":int,"category":"service"|"product"|"tips"|"rent"|"supplies"|"utilities"|"wages"|"other","entry_date":"YYYY-MM-DD","note":string}
- {"type":"reminder","kind":"reminder"|"payment","title":string,"due_date":"YYYY-MM-DD","due_time":"HH:MM"|null,"amount_cents":int|null}  (something the barber wants to be reminded of; "payment" when it is money to pay)
- {"type":"ledger","client_name":string,"kind":"charge"|"payment","amount_cents":int,"note":string|null}  (a client's tab: charge = client owes more, payment = client paid back)
- {"type":"query","metric":"income"|"expense"|"net"|"payables"|"receivables"|"appointments"|"top_service"|"client_balance"|"reminders","period":"today"|"yesterday"|"tomorrow"|"this_week"|"last_week"|"this_month"|"last_month"|"this_year","client_name":string|null}
- {"type":"unknown"}
Rules:
- A money note with several amounts becomes several "book" items, one per amount, each with its own kind and category ("made 100, paid 300 rent" = income 10000 + expense 30000 rent).
- Amounts are integer cents of the shop currency. Never add amounts together; never answer questions yourself: emit a "query" item.
- "payables" = what the barber still has to pay (bills, rent, suppliers); "receivables" = what clients owe the shop.
- Resolve relative dates from today. Times are 24h; in a barber shop "3" without am/pm means 15:00.
- Prefer names from the given lists when they match. Reply in JSON only.`;

export function assistantClient(env: { url: string; key: string; model: string }): Deps['assistant'] {
  if (!env.key) return undefined;
  return async (input: AssistantInput) => {
    const res = await fetch(new URL('/chat/completions', env.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.key}` },
      body: JSON.stringify({
        model: env.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              today: input.today,
              weekday: input.weekday,
              timezone: input.timezone,
              currency: input.currency,
              language: input.lang,
              services: input.services,
              barbers: input.barbers,
              clients: input.clients.slice(0, 300),
              message: input.text,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`assistant model ${res.status}`);
    const data: any = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  };
}
