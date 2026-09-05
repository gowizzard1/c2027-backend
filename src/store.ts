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
  accessToken?: string;
}) {
  return prisma.volunteer.create({ data });
}

export async function getVolunteers(options: PaginationOptions & { archived?: boolean } = {}) {
  const { page = 1, limit = 50, archived = false } = options;
  return prisma.volunteer.findMany({
    where: archived ? { status: 'archived' } : { status: { not: 'archived' } },
    // Explicitly omit passwordHash. Admins need support/activity information, but
    // password hashes must never leave the server, even through an admin endpoint.
    select: {
      id: true, name: true, email: true, phone: true, idNumber: true,
      county: true, constituency: true, ward: true, role: true, experience: true,
      status: true, accessToken: true, createdAt: true, updatedAt: true,
      archivedAt: true, statusBeforeArchive: true,
      inviteDeliveryStatus: true, inviteSentAt: true, inviteFailedAt: true,
      activatedAt: true, lastLoginAt: true, lastLoginFailedAt: true, loginFailureCount: true,
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function getVolunteerById(id: string) {
  return prisma.volunteer.findUnique({ where: { id } });
}

// ---- Volunteer secret toolkit access link ----
/** Look up a volunteer by their unguessable access token (used by the toolkit link). */
export async function findVolunteerByAccessToken(token: string) {
  if (!token) return null;
  return prisma.volunteer.findUnique({ where: { accessToken: token } });
}

/** Assign (or reset) a volunteer's access token. */
export async function setVolunteerAccessToken(id: string, token: string) {
  try {
    return await prisma.volunteer.update({ where: { id }, data: { accessToken: token } });
  } catch {
    return null;
  }
}

/** Set a volunteer's password hash and record account activation. */
export async function setVolunteerPassword(id: string, passwordHash: string) {
  return prisma.volunteer.update({
    where: { id },
    data: { passwordHash, activatedAt: new Date(), lastLoginAt: new Date(), loginFailureCount: 0 },
  });
}

/** Record a successful email/password login and clear the current failure count. */
export async function recordVolunteerLoginSuccess(id: string) {
  return prisma.volunteer.update({
    where: { id },
    data: { lastLoginAt: new Date(), loginFailureCount: 0 },
  });
}

/** Record a failed login attempt for an existing volunteer account. */
export async function recordVolunteerLoginFailure(id: string) {
  return prisma.volunteer.update({
    where: { id },
    data: { lastLoginFailedAt: new Date(), loginFailureCount: { increment: 1 } },
  });
}

/** Record whether an invite email was accepted by the configured email provider. */
export async function recordVolunteerInviteResult(id: string, sent: boolean) {
  return prisma.volunteer.update({
    where: { id },
    data: sent
      ? { inviteDeliveryStatus: 'sent', inviteSentAt: new Date() }
      : { inviteDeliveryStatus: 'failed', inviteFailedAt: new Date() },
  });
}

/**
 * Reset a volunteer's access: assign a fresh token and clear their password so
 * they can re-activate via a new invite link (admin-driven "forgot password").
 */
export async function regenerateVolunteerAccess(id: string, token: string) {
  try {
    return await prisma.volunteer.update({
      where: { id },
      data: {
        accessToken: token,
        passwordHash: null,
        activatedAt: null,
        inviteDeliveryStatus: 'not_sent',
      },
    });
  } catch {
    return null;
  }
}

/** Find a volunteer by email (case-insensitive) for password login. */
export async function findVolunteerByEmail(email: string) {
  return prisma.volunteer.findFirst({
    where: { email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateVolunteerStatus(id: string, status: string) {
  try {
    return await prisma.volunteer.update({ where: { id }, data: { status } });
  } catch {
    return null;
  }
}

/** Archive a volunteer without deleting their data or account history. */
export async function archiveVolunteer(id: string) {
  try {
    const volunteer = await prisma.volunteer.findUnique({ where: { id } });
    if (!volunteer || volunteer.status === 'archived') return null;
    return await prisma.volunteer.update({
      where: { id },
      data: {
        statusBeforeArchive: volunteer.status,
        status: 'archived',
        archivedAt: new Date(),
      },
    });
  } catch {
    return null;
  }
}

/** Restore a volunteer to the status they held before being archived. */
export async function restoreVolunteer(id: string) {
  try {
    const volunteer = await prisma.volunteer.findUnique({ where: { id } });
    if (!volunteer || volunteer.status !== 'archived') return null;
    return await prisma.volunteer.update({
      where: { id },
      data: {
        status: volunteer.statusBeforeArchive || 'pending',
        statusBeforeArchive: null,
        archivedAt: null,
      },
    });
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
  siteName: 'Isaac K. Maiywa',
  tagline: 'Kirgit Kipkeleny Tulwo',
  heroTitle: 'Kirgit Kipkeleny Tulwo',
  heroSubtitle: 'A vision of prosperity, unity, and progress for every citizen.',
  donationGoal: 10000000,
  whatsappLink: '',
  contactEmail: '',
  contactPhone: '',
  address: '',
  candidatePhoto: '',
  // Social-media volunteer team: group invite link + default share content.
  socialGroupLink: '',
  socialShareMessage: '',
  socialShareUrl: '',
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
    socialGroupLink: map.socialGroupLink ?? DEFAULT_SETTINGS.socialGroupLink,
    socialShareMessage: map.socialShareMessage ?? DEFAULT_SETTINGS.socialShareMessage,
    socialShareUrl: map.socialShareUrl ?? DEFAULT_SETTINGS.socialShareUrl,
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

// ---- First-party site analytics (anonymous, no IP/raw user-agent storage) ----
export async function recordAnalyticsEvent(data: {
  visitorId: string;
  path: string;
  referrerDomain?: string;
  deviceType: string;
}) {
  return prisma.analyticsEvent.create({ data });
}

function countBy<T>(items: T[], keyOf: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate lightweight site metrics for the protected admin dashboard.
 * Events are anonymous and only the requested recent date range is queried.
 */
export async function getAnalyticsSummary(days = 30) {
  const safeDays = Math.max(1, Math.min(90, days));
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - (safeDays - 1));

  const events = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: from } },
    select: { visitorId: true, path: true, referrerDomain: true, deviceType: true, createdAt: true },
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayEvents = events.filter(event => event.createdAt >= today);

  const dailyMap = new Map<string, { visitors: Set<string>; pageviews: number }>();
  for (let index = safeDays - 1; index >= 0; index--) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - index);
    dailyMap.set(date.toISOString().slice(0, 10), { visitors: new Set(), pageviews: 0 });
  }
  for (const event of events) {
    const day = event.createdAt.toISOString().slice(0, 10);
    const bucket = dailyMap.get(day);
    if (bucket) {
      bucket.pageviews++;
      bucket.visitors.add(event.visitorId);
    }
  }

  const pageStats = new Map<string, { visitors: Set<string>; pageviews: number }>();
  for (const event of events) {
    const current = pageStats.get(event.path) || { visitors: new Set<string>(), pageviews: 0 };
    current.pageviews++;
    current.visitors.add(event.visitorId);
    pageStats.set(event.path, current);
  }

  return {
    days: safeDays,
    totalPageviews: events.length,
    uniqueVisitors: new Set(events.map(event => event.visitorId)).size,
    todayPageviews: todayEvents.length,
    todayVisitors: new Set(todayEvents.map(event => event.visitorId)).size,
    daily: [...dailyMap.entries()].map(([date, value]) => ({
      date,
      pageviews: value.pageviews,
      visitors: value.visitors.size,
    })),
    topPages: [...pageStats.entries()]
      .map(([path, stats]) => ({ path, visitors: stats.visitors.size, pageviews: stats.pageviews }))
      .sort((a, b) => b.pageviews - a.pageviews)
      .slice(0, 8),
    referrers: countBy(events, event => event.referrerDomain || 'Direct / unknown').slice(0, 8),
    devices: countBy(events, event => event.deviceType).slice(0, 4),
  };
}

// ---- Weekly mobile-data stipend workflow ----
const STIPEND_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export async function getVolunteerStipendStatus(volunteerId: string) {
  const pending = await prisma.stipendRequest.findFirst({
    where: { volunteerId, status: 'pending' },
    orderBy: { requestedAt: 'desc' },
  });
  if (pending) {
    return {
      canRequest: false,
      reason: 'A stipend request is already awaiting review.',
      nextEligibleAt: null,
      latestRequest: pending,
    };
  }

  const latestIssued = await prisma.stipendRequest.findFirst({
    where: { volunteerId, status: { in: ['approved', 'paid'] } },
    orderBy: { requestedAt: 'desc' },
  });
  if (!latestIssued) {
    return { canRequest: true, reason: null, nextEligibleAt: null, latestRequest: null };
  }

  const issuedAt = latestIssued.paidAt || latestIssued.approvedAt || latestIssued.requestedAt;
  const nextEligibleAt = new Date(issuedAt.getTime() + STIPEND_COOLDOWN_MS);
  const canRequest = nextEligibleAt <= new Date();
  return {
    canRequest,
    reason: canRequest ? null : 'Mobile-data stipends are available once every 7 days after approval.',
    nextEligibleAt: canRequest ? null : nextEligibleAt,
    latestRequest: latestIssued,
  };
}

export async function createStipendRequest(volunteerId: string) {
  return prisma.stipendRequest.create({ data: { volunteerId } });
}

export async function getStipendRequests(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  const requests = await prisma.stipendRequest.findMany({
    orderBy: { requestedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const volunteerIds = [...new Set(requests.map(request => request.volunteerId))];
  const volunteers = await prisma.volunteer.findMany({
    where: { id: { in: volunteerIds } },
    select: { id: true, name: true, email: true, phone: true, role: true, status: true },
  });
  const byId = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  return requests.map(request => ({ ...request, volunteer: byId.get(request.volunteerId) || null }));
}

async function updateStipendRequestStatus(id: string, fromStatus: string, data: {
  status: string;
  approvedAt?: Date;
  paidAt?: Date;
  rejectedAt?: Date;
  adminNote?: string;
  paymentRef?: string;
}) {
  const result = await prisma.stipendRequest.updateMany({ where: { id, status: fromStatus }, data });
  if (result.count !== 1) return null;
  return prisma.stipendRequest.findUnique({ where: { id } });
}

export function approveStipendRequest(id: string, adminNote?: string) {
  return updateStipendRequestStatus(id, 'pending', { status: 'approved', approvedAt: new Date(), adminNote });
}

export function rejectStipendRequest(id: string, adminNote?: string) {
  return updateStipendRequestStatus(id, 'pending', { status: 'rejected', rejectedAt: new Date(), adminNote });
}

export function markStipendRequestPaid(id: string, paymentRef?: string) {
  return updateStipendRequestStatus(id, 'approved', { status: 'paid', paidAt: new Date(), paymentRef });
}
