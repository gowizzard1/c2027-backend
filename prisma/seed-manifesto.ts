/**
 * Seed script: Turbo manifesto pillars + website headline.
 *
 * Run with:
 *   cd backend
 *   npx ts-node prisma/seed-manifesto.ts
 *
 * Idempotent: clears existing manifesto items and re-inserts the full set.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Pillar {
  pillar: string;
  icon: string;
  title: string;
  description: string;
  details: string[];
  sortOrder: number;
}

const pillars: Pillar[] = [
  {
    pillar: 'EDUCATION',
    icon: '🎓',
    title: 'Expand Access to Quality Education',
    description:
      'Strengthen educational opportunity for students across Turbo through better access, infrastructure, skills and targeted support.',
    details: [
      'Strengthen access to constituency bursaries and scholarships through transparent, needs-based processes.',
      'Advocate for improved infrastructure in schools, including classrooms, laboratories, sanitation and digital learning facilities.',
      'Promote technical and vocational education for young people who choose skills-based careers.',
      'Support mentorship, career guidance and digital-skills programmes.',
      'Publish clear information on available education opportunities and beneficiaries.',
    ],
    sortOrder: 1,
  },
  {
    pillar: 'YOUTH & EMPLOYMENT',
    icon: '💼',
    title: 'Turn Youth Potential into Opportunity',
    description:
      'Create stronger pathways from education and talent to employment, entrepreneurship and the digital economy.',
    details: [
      'Support youth entrepreneurship and business development programmes.',
      'Promote digital skills, coding, AI, freelancing and remote-work opportunities.',
      'Advocate for transparent access to government youth programmes.',
      'Support sports and creative industries as avenues for talent and income.',
      'Build partnerships with private-sector organisations for internships, apprenticeships and skills development.',
    ],
    sortOrder: 2,
  },
  {
    pillar: 'AGRICULTURE',
    icon: '🌾',
    title: 'Strengthen Farmers and Agricultural Value Chains',
    description:
      'Improve productivity, market access and value addition for farmers and livestock keepers.',
    details: [
      'Advocate for better agricultural extension services.',
      'Promote climate-smart and technology-enabled farming.',
      'Strengthen farmer access to reliable markets and market information.',
      'Encourage agro-processing and value addition within the constituency.',
      'Support initiatives addressing post-harvest losses and livestock development.',
    ],
    sortOrder: 3,
  },
  {
    pillar: 'ROADS & INFRASTRUCTURE',
    icon: '🛣️',
    title: 'Better Infrastructure, Better Connectivity',
    description:
      'Advocate for improved roads, water, electricity and digital infrastructure across Turbo.',
    details: [
      'Identify priority roads requiring construction, rehabilitation or maintenance.',
      'Work with relevant national and county agencies to pursue infrastructure projects.',
      'Advocate for improved access to clean and reliable water.',
      'Promote expansion of electricity and internet connectivity.',
      'Maintain a publicly accessible record of major infrastructure priorities and progress.',
    ],
    sortOrder: 4,
  },
  {
    pillar: 'HEALTHCARE',
    icon: '🏥',
    title: 'Accessible and Dignified Healthcare',
    description:
      'Advocate for better-equipped health facilities and improved access to essential healthcare services.',
    details: [
      'Advocate for adequate staffing and equipment in health facilities.',
      'Support improved access to essential medicines and diagnostic services.',
      'Promote maternal, child and preventive healthcare.',
      'Strengthen health-awareness and community outreach programmes.',
      'Work with relevant government agencies to address gaps identified by residents.',
    ],
    sortOrder: 5,
  },
  {
    pillar: 'SMALL BUSINESSES & ENTERPRISE',
    icon: '🏪',
    title: 'Build a Strong Local Economy',
    description:
      'Create an environment where small businesses, traders and entrepreneurs can start, grow and employ others.',
    details: [
      'Promote entrepreneurship training and financial literacy.',
      'Advocate for improved trading facilities and business infrastructure.',
      'Connect local entrepreneurs with markets, investors and relevant government programmes.',
      'Encourage digital adoption among small businesses.',
      'Support initiatives that promote local production and value addition.',
    ],
    sortOrder: 6,
  },
  {
    pillar: 'WOMEN & FAMILIES',
    icon: '👩🏽‍👧🏽',
    title: 'Expand Economic Opportunities for Women',
    description:
      "Support programmes that improve women's economic participation, skills and access to opportunity.",
    details: [
      'Promote entrepreneurship and skills development programmes.',
      'Improve awareness of available government financing and support programmes.',
      'Encourage women-led cooperatives and businesses.',
      "Support initiatives addressing barriers to women's participation in the economy.",
    ],
    sortOrder: 7,
  },
  {
    pillar: 'SPORTS & CREATIVE ARTS',
    icon: '⚽',
    title: 'Talent as an Economic Opportunity',
    description:
      'Build pathways for talented young people to develop their skills and turn talent into sustainable careers.',
    details: [
      'Support grassroots sporting activities and talent identification.',
      'Promote access to sporting facilities and equipment.',
      'Support creative arts, music, film and cultural activities.',
      'Connect talented young people with competitions, training and professional opportunities.',
      'Encourage partnerships with private organisations and sporting bodies.',
    ],
    sortOrder: 8,
  },
  {
    pillar: 'DIGITAL TURBO',
    icon: '💻',
    title: 'Make Turbo Part of the Digital Economy',
    description:
      'Equip residents with the connectivity and digital skills required for the modern economy.',
    details: [
      'Promote digital literacy programmes.',
      'Support training in software development, AI, cybersecurity and digital entrepreneurship.',
      'Advocate for improved internet connectivity.',
      'Encourage young people to access global digital-work opportunities.',
      'Promote digital access to information about government services and opportunities.',
    ],
    sortOrder: 9,
  },
  {
    pillar: 'ACCOUNTABILITY & TRANSPARENCY',
    icon: '⚖️',
    title: 'An Open and Accountable Constituency Office',
    description:
      'Make public participation, transparency and measurable results central to constituency leadership.',
    details: [
      'Provide regular public reports on constituency programmes and projects.',
      'Maintain transparent criteria for programmes administered through the constituency office.',
      'Establish channels through which residents can submit issues and track responses.',
      'Hold regular public consultations across the constituency.',
      'Publish progress against stated priorities and commitments.',
    ],
    sortOrder: 10,
  },
  {
    pillar: 'ENVIRONMENT',
    icon: '🌱',
    title: 'Protect Our Environment and Future',
    description:
      'Promote sustainable development, environmental conservation and climate resilience.',
    details: [
      'Promote tree planting and environmental conservation.',
      'Encourage sustainable agricultural practices.',
      'Support community environmental initiatives.',
      'Promote awareness of climate-related risks and adaptation measures.',
      'Advocate for responsible development and protection of natural resources.',
    ],
    sortOrder: 11,
  },
  {
    pillar: 'REPRESENTATION & LEGISLATION',
    icon: '🏛️',
    title: 'Stronger Representation for Turbo',
    description:
      "Make the constituency's priorities visible in Parliament through effective legislation, oversight and representation.",
    details: [
      'Represent constituency concerns in parliamentary debates and committees.',
      'Advocate for legislation addressing issues affecting residents.',
      'Exercise parliamentary oversight over national government programmes and expenditure.',
      'Regularly communicate parliamentary activity and outcomes to constituents.',
      'Establish a structured mechanism for collecting and prioritising issues raised by residents.',
    ],
    sortOrder: 12,
  },
];

async function main() {
  console.log('Clearing existing manifesto items...');
  await prisma.manifestoItem.deleteMany({});

  console.log(`Inserting ${pillars.length} manifesto pillars...`);
  for (const p of pillars) {
    await prisma.manifestoItem.create({
      data: {
        pillar: p.pillar,
        title: p.title,
        description: p.description,
        // Store each detail on its own line so the frontend can split/render as bullets.
        details: p.details.join('\n'),
        icon: p.icon,
        sortOrder: p.sortOrder,
      },
    });
    console.log(`  ✓ ${p.sortOrder}. ${p.pillar}`);
  }

  console.log('Setting website headline (heroTitle / heroSubtitle)...');
  // Settings are stored as key/value rows in the `Setting` table.
  const headline: Record<string, string> = {
    heroTitle: 'A Practical Agenda for Turbo',
    heroSubtitle:
      'A development platform focused on education, opportunity, infrastructure, agriculture, healthcare and accountable representation.',
  };
  await prisma.$transaction(
    Object.entries(headline).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  );

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
