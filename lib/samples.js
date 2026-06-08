// Built-in demo sites so the generated-website design can be reviewed/tested
// WITHOUT logging in or running a paid build. Rendered through the SAME render()
// in api/site.js, so they're pixel-identical to a real Pounce preview.
// NOTE: hero/gallery here use illustrative stock photos (loremflickr); a real
// Pounce build uses the lead's own vetted Google photos or an AI-curated hero.
const img = (kw, lock) => `https://loremflickr.com/1280/720/${kw}?lock=${lock}`;

const SAMPLES = {
  'sample-pap-electrical': {
    slug: 'sample-pap-electrical',
    mode: 'preview',
    v: 4,
    initials: 'PE',
    accent: null,
    offer: '£50 off your first job booked this month',
    business: {
      name: 'Pap Electrical',
      location: 'Coventry',
      category: 'Electrician',
      phone: '07704 525992',
      address: '38 Mercer Ave, Coventry CV2 4PN',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Pap%20Electrical%20Coventry',
    },
    hero: {
      headline: 'Your Trusted Local Electrician in Coventry',
      sub: 'Reliable, fully-insured electrical work — from extra sockets to full rewires. Free, no-obligation quotes.',
      image: img('electrician,electrical', 21),
      source: 'google',
    },
    trust: ['NICEIC Approved', 'Fully Insured', '5★ on Google', 'Free Quotes'],
    services: [
      { icon: '🏠', title: 'Residential Work', desc: 'Comprehensive electrical solutions for your home, done to the highest standard.' },
      { icon: '💡', title: 'Wiring & Lighting', desc: 'Expert installation of wiring and modern, energy-efficient lighting.' },
      { icon: '🔌', title: 'Sockets & Safety', desc: 'Safe, reliable socket installs and full electrical safety checks.' },
      { icon: '🚗', title: 'EV Charger Installs', desc: 'Home electric-vehicle charging points, fitted and certified.' },
      { icon: '🛠️', title: 'Fuse Board Upgrades', desc: 'Modern consumer units to keep your home safe and compliant.' },
      { icon: '⚡', title: 'Emergency Call-outs', desc: 'Fast response for urgent electrical faults, day or night.' },
    ],
    about: {
      heading: 'About Pap Electrical',
      paras: [
        'At Pap Electrical we pride ourselves on delivering exceptional electrical services across Coventry and the surrounding area. Our work is carried out by experienced, fully-insured electricians who treat every job — large or small — with the same care.',
        'Our reputation speaks for itself, with customers consistently praising our reliability, tidiness and expertise. Whether it\'s a single socket or a complete rewire, you can trust us to get the job done right first time.',
      ],
      stats: [
        { num: '5★', label: 'Google rating' },
        { num: '12+', label: '5-star reviews' },
        { num: '10+', label: 'Years experience' },
      ],
    },
    gallery: [img('electrical,wiring', 31), img('lighting,interior', 32), img('fusebox,electrician', 33), img('socket,electrical', 34)],
    reviews: [
      { rating: 5, text: 'I had a great experience with Pap Electrical. The electrician Denis was extremely professional and solved the issue right away. Highly recommended for anyone needing someone reliable and trustworthy!', name: 'Aaron A' },
      { rating: 5, text: 'I hired Pap Electrical to handle all the electrical work in my entire house and couldn\'t be more impressed. From start to finish their service was exceptional — punctual, knowledgeable and tidy. A true expert you can rely on.', name: 'Karen O' },
      { rating: 5, text: 'Booked Denis at relatively short notice as the last electrician bailed out. Very happy with the work and would use again 👍', name: 'Ben B' },
    ],
    faq: [
      { q: 'Do you charge for quotes?', a: 'No — all quotes are completely free and with no obligation.' },
      { q: 'Are you insured and qualified?', a: 'Yes. We\'re NICEIC approved and fully insured for your peace of mind.' },
      { q: 'Which areas do you cover?', a: 'Coventry and the surrounding towns — including Solihull, Bedworth, Nuneaton and Kenilworth.' },
      { q: 'Do you offer emergency call-outs?', a: 'Yes, we offer a fast-response service for urgent electrical faults.' },
    ],
    areasCovered: ['Coventry', 'Solihull', 'Bedworth', 'Nuneaton', 'Kenilworth', 'Rugby'],
    accreditations: ['NICEIC Approved', 'Fully Insured', 'Checkatrade Member'],
    contact: {
      phone: '07704 525992',
      area: 'Coventry',
      hours: ['Monday: Open 24 hours', 'Tuesday: Open 24 hours', 'Wednesday: Open 24 hours', 'Thursday: Open 24 hours', 'Friday: Open 24 hours', 'Saturday: Open 24 hours', 'Sunday: Closed'],
    },
    rating: 5,
    reviewCount: 12,
    establishedYear: '',
    seo: {
      title: 'Pap Electrical | Trusted Electrician in Coventry',
      description: 'Pap Electrical — NICEIC-approved, fully-insured electricians in Coventry. Rewires, sockets, lighting, EV chargers & emergency call-outs. Free quotes.',
    },
  },
};

module.exports = { SAMPLES };
