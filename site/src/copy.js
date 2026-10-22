// Copy the script fills in. The rest of the page's text lives in index.html.
// {name} {product} {email} {founder} come from brand.json.

export const FORM_ERROR = 'Couldn’t send. Check your connection and try again, or email {email}.';

// The "who it's for" tabs. Menus match the app's starting menus for each business type.
export const PANELS = {
  barber: {
    photo: '/media/barber.webp',
    photoAlt: 'A barber cutting a client’s hair with clippers',
    shot: '/shots/barber-today.webp',
    story: 'barber',
    link: '?sample=barber',
    title: 'Sales, the queue and regulars on the same screen.',
    menu: [
      ['Haircut', 30],
      ['Beard trim', 15],
      ['Haircut + beard', 40],
      ['Kids cut', 20],
    ],
    points: [
      ['No-shows', 'Automatic reminders the evening before and two hours ahead; clients who missed before are flagged.'],
      ['Client tabs', 'Who owes what at a glance; it closes when they pay.'],
      ['Closing-time math', 'The till adds itself up during the day; rent and bills are reminded on time.'],
    ],
    linkLabel: 'Tour this shop live',
  },
  salon: {
    photo: '/media/salon.webp',
    photoAlt: 'A stylist blow-drying a client’s hair',
    shot: '/shots/salon-today.webp',
    story: 'salon',
    link: '?sample=salon',
    title: 'Long services, a full calendar, detailed clients.',
    menu: [
      ['Cut & blow-dry', 45],
      ['Blow-dry', 25],
      ['Color', 90],
      ['Highlights', 120],
      ['Keratin treatment', 150],
    ],
    points: [
      ['Services that take hours', 'Color and highlights take their real space in the calendar; one chair never gets two jobs at once.'],
      ['Client notes', 'Which color she had and when her next treatment is due live on the client card.'],
      ['Win-backs', 'One tap to text a client who hasn’t been in for six weeks.'],
    ],
    linkLabel: 'Tour this salon live',
  },
  beauty: {
    photo: '/media/beauty.webp',
    photoAlt: 'A manicure in a nail salon',
    shot: '/shots/salon-today.webp',
    story: 'salon',
    link: '?sample=salon',
    title: 'Short appointments, frequent clients.',
    menu: [
      ['Manicure', 25],
      ['Pedicure', 35],
      ['Brows', 10],
      ['Facial', 60],
    ],
    points: [
      ['Frequent bookings', 'Short services like manicures and brows fill the day; reminders cut the empty chairs.'],
      ['Tips and products', 'Tips and product sales show up separately in the books.'],
      ['Team', 'Each person has their own day; no two jobs at the same time.'],
    ],
    linkLabel: 'Tour a similar salon live',
  },
  next: {
    photo: '/media/barber.webp',
    photoAlt: '',
    shot: '/shots/barber-today.webp',
    story: 'barber',
    link: '#demo',
    title: 'Every business that runs on appointments and regulars.',
    menu: ['Café', 'Tailor', 'Car wash', 'Repair shop', 'Pilates studio', 'Vet'],
    points: [
      ['We start in the field', 'We enter each new trade with the people who do the work; features are decided in the shop, not at a desk.'],
      ['One foundation', 'Appointments, sales, tabs, reminders and an assistant: what every small business shares.'],
      ['Suggest yours', 'Don’t see your business? Write it in the demo form; the first conversations set the order.'],
    ],
    linkLabel: 'Suggest your business',
  },
};
