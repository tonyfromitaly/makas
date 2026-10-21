> **DRAFT. Not reviewed by counsel. Do not publish.** Bracketed items are placeholders. This page is also what the A2P 10DLC campaign registration links to as the "terms" URL.

# Monacount Appointment Reminders: SMS Terms

**Program.** Appointment reminders from the business you booked with, sent through Monacount by [COMPANY LEGAL NAME].

**What you'll get.**

- Reminders about appointments you booked: one the day before and, for some appointments, one on the day.
- At most 2 messages per appointment.
- No marketing messages.

**How you sign up.**

- By ticking "Text me reminders for this appointment" when you book online, or
- by telling the business in person that you want reminders.

Consent is not a condition of booking or of any purchase.

**How to stop.**

- Reply **STOP** to any message. You will get one confirmation and no further messages.
- To get reminders again, tell the business. It records your new consent.

**Help.**

- Reply **HELP** to any message, or contact the business directly.
- For questions about the program, write to [SUPPORT EMAIL].

**Costs.** Message and data rates may apply. Monacount does not charge you for reminders.

**Carriers.** Carriers are not liable for delayed or undelivered messages.

**Privacy.** Your phone number is used only to send reminders for your appointments. It is never sold or shared for marketing. See the [Privacy Policy](privacy-policy.md).

---

## Message samples (for the campaign registration)

- "Hi Jane, your Haircut at Northside Barbers is tomorrow at 3:00 PM. See you soon! Reply STOP to opt out."
- "Jane, a reminder: your appointment at Northside Barbers is today at 3:00 PM. Reply STOP to opt out."

## Keyword replies (set in the Twilio Messaging Service, "Advanced Opt-Out")

| Keyword | Reply |
|---|---|
| STOP, CANCEL, END, QUIT, UNSUBSCRIBE, STOPALL | "You're unsubscribed from appointment reminders and won't receive more messages. To get them again, ask the business you booked with." |
| HELP, INFO | "Monacount appointment reminders for the business you booked with. Up to 2 msgs per appointment. Msg & data rates may apply. Reply STOP to opt out. Help: [SUPPORT EMAIL]" |
| START, YES, UNSTOP | "To get reminders again, ask the business you booked with. Reply HELP for help." |

Monacount revokes consent on STOP. START only lifts the carrier-side block; it does not turn reminders back on. That needs new consent recorded by the business, so the reply says so.
