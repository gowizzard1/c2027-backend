/**
 * Data access layer — all persistence via Prisma.
 */
import prisma from './db';
import logger from './lib/logger';

// ---- Types (re-exported for route use) ----
export type { Donation, Volunteer, Order, NewsItem, Product, Setting } from '@prisma/client';

interface PaginationOptions {
  page?: number;
  limit?: number;
}

// ---- Admin auth (env-only, not stored in DB) ----
export function validateAdmin(username: string, password: string): boolean {
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'campaign2027';

  // Constant-time comparison to prevent timing attacks
  if (username.length !== ADMIN_USERNAME.length || password.length !== ADMIN_PASSWORD.length) {
    return false;
  }

  let usernameMatch = true;
  let passwordMatch = true;
  for (let i = 0; i < ADMIN_USERNAME.length; i++) {
    if (username[i] !== ADMIN_USERNAME[i]) usernameMatch = false;
  }
  for (let i = 0; i < ADMIN_PASSWORD.length; i++) {
    if (password[i] !== ADMIN_PASSWORD[i]) passwordMatch = false;
  }

  return usernameMatch && passwordMatch;
}

// ---- Donations ----
export async function addDonation(data: {
  id: string;
  amount: number;
  name: string;
  email: string;
  phone: string;
  paymentMethod: string;
  status: string;
  mpesaRequestId?: string;
}) {
  return prisma.donation.create({ data });
}

export async function getDonations(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  return prisma.donation.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function getDonationProgress() {
  const settings = await getSettings();
  const goal = settings.donationGoal;

  const result = await prisma.donation.aggregate({
    where: { status: 'completed' },
    _sum: { amount: true },
    _count: { id: true },
  });

  return {
    raised: result._sum.amount ?? 0,
    goal,
    donors: result._count.id,
  };
}

export async function updateDonationStatus(
  mpesaRequestId: string,
  status: string,
  mpesaReceiptNumber?: string
) {
  const donation = await prisma.donation.findFirst({ where: { mpesaRequestId } });
  if (!donation) {
    logger.warn({ mpesaRequestId }, 'Donation not found for M-Pesa callback');
    return null;
  }

  // Prevent double-processing
  if (donation.status === 'completed' && status === 'completed') {
    logger.info({ mpesaRequestId }, 'Donation already completed — skipping duplicate callback');
    return donation;
  }

  return prisma.donation.update({
    where: { id: donation.id },
    data: { status, ...(mpesaReceiptNumber ? { mpesaReceiptNumber } : {}) },
  });
}

// ---- Volunteers ----
export async function addVolunteer(data: {
  id: string;
  name: string;
  email: string;
  phone: string;
  idNumber: string;
  county: string;
  constituency: string;
  ward: string;
  role: string;
  experience?: string;
}) {
  return prisma.volunteer.create({ data });
}

export async function getVolunteers(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  return prisma.volunteer.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function updateVolunteerStatus(id: string, status: string) {
  try {
    return await prisma.volunteer.update({ where: { id }, data: { status } });
  } catch {
    return null;
  }
}

// ---- Orders ----
export async function addOrder(data: {
  id: string;
  itemsJson: string;
  total: number;
  name: string;
  phone: string;
  deliveryAddress?: string;
}) {
  return prisma.order.create({ data });
}

export async function getOrders(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function updateOrderStatus(id: string, status: string) {
  try {
    return await prisma.order.update({ where: { id }, data: { status } });
  } catch {
    return null;
  }
}

// ---- News / Events / Photos ----
export async function addNewsItem(data: {
  id: string;
  title: string;
  content?: string;
  date: string;
  category: string;
  type: string;
  image?: string;
  emoji?: string;
  time?: string;
  location?: string;
}) {
  return prisma.newsItem.create({ data });
}

export async function getNews(type?: string) {
  return prisma.newsItem.findMany({
    where: type ? { type } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateNewsItem(id: string, updates: Partial<{
  title: string; content: string; category: string; type: string;
  image: string; emoji: string; time: string; location: string; date: string;
}>) {
  try {
    return await prisma.newsItem.update({ where: { id }, data: updates });
  } catch {
    return null;
  }
}

export async function deleteNewsItem(id: string) {
  try {
    await prisma.newsItem.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// ---- Products ----
export async function addProduct(data: {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  sizesJson?: string;
  inStock: boolean;
}) {
  return prisma.product.create({ data });
}

export async function getProducts(category?: string) {
  return prisma.product.findMany({
    where: category && category !== 'All' ? { category } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateProduct(id: string, updates: any) {
  try {
    return await prisma.product.update({ where: { id }, data: updates });
  } catch {
    return null;
  }
}

export async function deleteProduct(id: string) {
  try {
    await prisma.product.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// ---- Campaign Settings ----
const DEFAULT_SETTINGS = {
  siteName: 'Campaign 2027',
  tagline: 'Together We Rise',
  heroTitle: 'Together We Rise',
  heroSubtitle: 'A vision of prosperity, unity, and progress for every citizen.',
  donationGoal: 10000000,
  whatsappLink: '',
  contactEmail: '',
  contactPhone: '',
  address: '',
  candidatePhoto: '',
  visionItems: [] as { icon: string; title: string; description: string }[],
};

export async function getSettings() {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  return {
    siteName: map.siteName ?? DEFAULT_SETTINGS.siteName,
    tagline: map.tagline ?? DEFAULT_SETTINGS.tagline,
    heroTitle: map.heroTitle ?? DEFAULT_SETTINGS.heroTitle,
    heroSubtitle: map.heroSubtitle ?? DEFAULT_SETTINGS.heroSubtitle,
    donationGoal: map.donationGoal ? Number(map.donationGoal) : DEFAULT_SETTINGS.donationGoal,
    whatsappLink: map.whatsappLink ?? DEFAULT_SETTINGS.whatsappLink,
    contactEmail: map.contactEmail ?? DEFAULT_SETTINGS.contactEmail,
    contactPhone: map.contactPhone ?? DEFAULT_SETTINGS.contactPhone,
    address: map.address ?? DEFAULT_SETTINGS.address,
    candidatePhoto: map.candidatePhoto ?? DEFAULT_SETTINGS.candidatePhoto,
    visionItems: map.visionItems ? JSON.parse(map.visionItems) : DEFAULT_SETTINGS.visionItems,
  };
}

export async function updateSettings(updates: Partial<typeof DEFAULT_SETTINGS & { donationGoal: number }>) {
  const ops = Object.entries(updates).map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      update: { value: typeof value === 'object' ? JSON.stringify(value) : String(value) },
      create: { key, value: typeof value === 'object' ? JSON.stringify(value) : String(value) },
    })
  );
  await prisma.$transaction(ops);
  return getSettings();
}

// ---- Manifesto ----
export async function getManifesto() {
  return prisma.manifestoItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function addManifestoItem(data: {
  id: string; pillar: string; title: string;
  description: string; details?: string; icon: string; sortOrder: number;
}) {
  return prisma.manifestoItem.create({ data });
}

export async function updateManifestoItem(id: string, updates: Partial<{
  pillar: string; title: string; description: string; details: string; icon: string; sortOrder: number;
}>) {
  try {
    return await prisma.manifestoItem.update({ where: { id }, data: updates });
  } catch {
    return null;
  }
}

export async function deleteManifestoItem(id: string) {
  try {
    await prisma.manifestoItem.delete({ where: { id } });
    return true;
  } catch { return false; }
}

// ---- Biography ----
export async function getBiography() {
  return prisma.biography.findMany({ orderBy: { section: 'asc' } });
}

export async function upsertBioSection(section: string, content: string) {
  return prisma.biography.upsert({
    where: { section },
    update: { content },
    create: { id: section, section, content },
  });
}

// ---- Payment Mode ----
export async function getPaymentMode(): Promise<'live' | 'mock'> {
  const row = await prisma.setting.findUnique({ where: { key: 'paymentMode' } });
  return (row?.value as 'live' | 'mock') ?? 'mock';
}

export async function setPaymentMode(mode: 'live' | 'mock') {
  return prisma.setting.upsert({
    where: { key: 'paymentMode' },
    update: { value: mode },
    create: { key: 'paymentMode', value: mode },
  });
}

// ---- Pledges (donation interest captured while payments are under integration) ----
export async function addPledge(data: {
  id: string;
  name: string;
  email: string;
  phone: string;
  amount?: number;
  message?: string;
}) {
  return prisma.pledge.create({ data });
}

export async function getPledges(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  return prisma.pledge.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function updatePledgeStatus(id: string, status: string) {
  try {
    return await prisma.pledge.update({ where: { id }, data: { status } });
  } catch {
    return null;
  }
}

export async function deletePledge(id: string) {
  try {
    await prisma.pledge.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
