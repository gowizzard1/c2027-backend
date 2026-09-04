/**
 * Seed script: candidate biography sections (CMS -> Biography tab / About page).
 *
 * Run with:
 *   cd backend
 *   npx ts-node prisma/seed-biography.ts
 *
 * Idempotent: upserts each section by its key.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Keys must match the CMS BiographyPanel: summary | background | why | vision
const sections: Record<string, string> = {
  summary:
    'Isaac Kiptanui Maiywa is a technology professional, community-minded leader and advocate for inclusive development. With a background in software engineering and a strong connection to Turbo, he brings a modern, solutions-oriented perspective to public leadership.',

  background: [
    'Technology • Software Engineering • Community Engagement • Youth Development',
    '',
    'Isaac has built his professional experience in technology and software engineering, working with modern digital platforms and solving complex problems through innovation and practical solutions. His experience in technology has shaped his belief that young people need access to quality education, skills, connectivity and meaningful economic opportunities.',
    '',
    'Beyond his professional career, he has remained engaged with community issues and the aspirations of residents of Turbo, particularly around education, infrastructure, employment and representation.',
  ].join('\n'),

  why:
    "I believe Turbo deserves leadership that listens, understands today's challenges and approaches development with a practical, forward-looking mindset. I am stepping forward to offer my experience, energy and commitment to public service and to contribute to a stronger future for our constituency.",

  vision:
    'A prosperous, connected and empowered Turbo where every young person has an opportunity to build a meaningful future, families can access essential services, farmers can prosper, businesses can grow, and residents have accountable and effective representation.',
};

async function main() {
  console.log('Upserting biography sections...');
  for (const [section, content] of Object.entries(sections)) {
    await prisma.biography.upsert({
      where: { section },
      update: { content },
      create: { id: section, section, content },
    });
    console.log(`  ✓ ${section}`);
  }
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
