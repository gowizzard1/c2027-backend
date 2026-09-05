/**
 * Data access layer — all persistence via Prisma.
 */
import crypto from 'crypto';
import prisma from './db';
import logger from './lib/logger';
import { TURBO_COUNTY, TURBO_CONSTITUENCY, isTurboWard } from './lib/polling';

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
      approvedAt: true, archivedAt: true, statusBeforeArchive: true,
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
    const volunteer = await prisma.volunteer.findUnique({ where: { id } });
    if (!volunteer) return null;
    return await prisma.volunteer.update({
      where: { id },
      data: {
        status,
        // Preserve the original active date through suspension/unsuspension.
        ...(status === 'approved' && !volunteer.approvedAt ? { approvedAt: new Date() } : {}),
      },
    });
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
  mobilizerGroupLink: '',
  // Days an approved volunteer must be active before their first stipend request.
  stipendActivationDelayDays: 7,
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
    mobilizerGroupLink: map.mobilizerGroupLink ?? DEFAULT_SETTINGS.mobilizerGroupLink,
    stipendActivationDelayDays: map.stipendActivationDelayDays ? Number(map.stipendActivationDelayDays) : DEFAULT_SETTINGS.stipendActivationDelayDays,
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
const STIPEND_REPEAT_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getVolunteerStipendStatus(volunteerId: string) {
  const [volunteer, settings] = await Promise.all([
    prisma.volunteer.findUnique({ where: { id: volunteerId } }),
    getSettings(),
  ]);
  const activationDelayDays = Math.max(0, Number(settings.stipendActivationDelayDays) || 0);

  if (!volunteer) {
    return { canRequest: false, reason: 'Volunteer account not found.', nextEligibleAt: null, latestRequest: null, activationDelayDays, repeatCooldownDays: STIPEND_REPEAT_COOLDOWN_DAYS };
  }

  // Existing approved volunteers may predate approvedAt; use registration date as a safe fallback.
  const activeSince = volunteer.approvedAt || volunteer.createdAt;
  const firstEligibleAt = new Date(activeSince.getTime() + activationDelayDays * DAY_MS);
  if (firstEligibleAt > new Date()) {
    return {
      canRequest: false,
      reason: `Mobile-data stipend requests become available after ${activationDelayDays} active day${activationDelayDays === 1 ? '' : 's'}.`,
      nextEligibleAt: firstEligibleAt,
      latestRequest: null,
      activationDelayDays,
      repeatCooldownDays: STIPEND_REPEAT_COOLDOWN_DAYS,
    };
  }

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
      activationDelayDays,
      repeatCooldownDays: STIPEND_REPEAT_COOLDOWN_DAYS,
    };
  }

  const latestIssued = await prisma.stipendRequest.findFirst({
    where: { volunteerId, status: { in: ['approved', 'paid'] } },
    orderBy: { requestedAt: 'desc' },
  });
  if (!latestIssued) {
    return { canRequest: true, reason: null, nextEligibleAt: null, latestRequest: null, activationDelayDays, repeatCooldownDays: STIPEND_REPEAT_COOLDOWN_DAYS };
  }

  const issuedAt = latestIssued.paidAt || latestIssued.approvedAt || latestIssued.requestedAt;
  const nextEligibleAt = new Date(issuedAt.getTime() + STIPEND_REPEAT_COOLDOWN_DAYS * DAY_MS);
  const canRequest = nextEligibleAt <= new Date();
  return {
    canRequest,
    reason: canRequest ? null : `Mobile-data stipends are available once every ${STIPEND_REPEAT_COOLDOWN_DAYS} days after approval.`,
    nextEligibleAt: canRequest ? null : nextEligibleAt,
    latestRequest: latestIssued,
    activationDelayDays,
    repeatCooldownDays: STIPEND_REPEAT_COOLDOWN_DAYS,
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

// ---- Mobilizer weekly reports (aggregate activity only) ----
function currentWeekStartUtc(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  // JavaScript Sunday = 0; convert to a Monday-start reporting week.
  const day = start.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export async function getMobilizerDashboard(volunteerId: string) {
  const periodStart = currentWeekStartUtc();
  const [currentReport, recentReports, settings] = await Promise.all([
    prisma.mobilizerReport.findUnique({ where: { volunteerId_periodStart: { volunteerId, periodStart } } }),
    prisma.mobilizerReport.findMany({ where: { volunteerId }, orderBy: { periodStart: 'desc' }, take: 4 }),
    getSettings(),
  ]);
  return {
    groupLink: settings.mobilizerGroupLink || settings.whatsappLink || '',
    periodStart,
    currentReport,
    recentReports,
  };
}

export async function createMobilizerReport(volunteerId: string, data: {
  peopleReached: number;
  meetingsHeld: number;
  newVolunteers: number;
  keyIssues?: string;
  notes?: string;
}) {
  const periodStart = currentWeekStartUtc();
  try {
    return await prisma.mobilizerReport.create({ data: { volunteerId, periodStart, ...data } });
  } catch {
    // Unique weekly-report constraint means one submission per mobilizer per week.
    return null;
  }
}

export async function getMobilizerReports(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  const reports = await prisma.mobilizerReport.findMany({
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const volunteerIds = [...new Set(reports.map(report => report.volunteerId))];
  const volunteers = await prisma.volunteer.findMany({
    where: { id: { in: volunteerIds } },
    select: { id: true, name: true, email: true, phone: true, ward: true, constituency: true, status: true },
  });
  const byId = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  return reports.map(report => ({ ...report, volunteer: byId.get(report.volunteerId) || null }));
}

export async function updateMobilizerReportStatus(id: string, status: 'reviewed' | 'actioned', adminNote?: string) {
  try {
    return await prisma.mobilizerReport.update({
      where: { id },
      data: { status, adminNote, reviewedAt: new Date() },
    });
  } catch {
    return null;
  }
}

// ---- Multi-role volunteer accounts ----
// These functions are the new account/assignment layer. Legacy Volunteer functions remain
// temporarily during the additive migration window, but new routes use this layer exclusively.
export function normalizeVolunteerEmail(email: string) {
  return email.trim().toLowerCase();
}

function newAccessToken() {
  return crypto.randomBytes(24).toString('base64url');
}

const accountSelect = {
  id: true, email: true, emailNormalized: true, name: true, phone: true, idNumber: true,
  accessToken: true, inviteDeliveryStatus: true, inviteSentAt: true, inviteFailedAt: true,
  activatedAt: true, lastLoginAt: true, lastLoginFailedAt: true, loginFailureCount: true,
  sessionVersion: true, createdAt: true, updatedAt: true,
} as const;

const assignmentSelect = {
  id: true, accountId: true, role: true, experience: true, county: true, constituency: true, ward: true,
  pollingStationId: true,
  pollingStation: { select: { id: true, name: true, ward: true, active: true } },
  status: true, approvedAt: true, archivedAt: true, statusBeforeArchive: true, createdAt: true, updatedAt: true,
} as const;

export async function registerVolunteerRole(data: {
  name: string;
  email: string;
  phone: string;
  idNumber: string;
  county: string;
  constituency: string;
  ward: string;
  role: string;
  experience?: string;
  pollingStationId?: string;
}) {
  const emailNormalized = normalizeVolunteerEmail(data.email);
  return prisma.$transaction(async tx => {
    let account = await tx.volunteerAccount.findUnique({ where: { emailNormalized } });
    let createdAccount = false;

    if (!account) {
      account = await tx.volunteerAccount.create({
        data: {
          id: crypto.randomUUID(),
          email: data.email.trim(),
          emailNormalized,
          name: data.name.trim(),
          phone: data.phone.trim(),
          idNumber: data.idNumber.trim(),
          accessToken: newAccessToken(),
        },
      });
      createdAccount = true;
    } else if (!account.passwordHash && !account.accessToken) {
      account = await tx.volunteerAccount.update({
        where: { id: account.id },
        data: { accessToken: newAccessToken() },
      });
    }

    const existing = await tx.volunteerRoleAssignment.findUnique({
      where: { accountId_role: { accountId: account.id, role: data.role } },
    });
    if (existing) return { account, assignment: existing, createdAccount, duplicateRole: true };

    const assignment = await tx.volunteerRoleAssignment.create({
      data: {
        id: crypto.randomUUID(),
        accountId: account.id,
        role: data.role,
        experience: data.experience,
        county: data.county.trim(),
        constituency: data.constituency.trim(),
        ward: data.ward.trim(),
        pollingStationId: data.pollingStationId,
      },
    });
    return { account, assignment, createdAccount, duplicateRole: false };
  });
}

export async function getVolunteerAccountById(id: string) {
  return prisma.volunteerAccount.findUnique({ where: { id } });
}

export async function getVolunteerAccountByEmail(email: string) {
  return prisma.volunteerAccount.findUnique({ where: { emailNormalized: normalizeVolunteerEmail(email) } });
}

export async function getVolunteerAccountByAccessToken(token: string) {
  if (!token) return null;
  return prisma.volunteerAccount.findUnique({ where: { accessToken: token } });
}

export async function getRoleAssignmentById(id: string) {
  return prisma.volunteerRoleAssignment.findUnique({ where: { id }, include: { pollingStation: true } });
}

export async function getAccountAssignments(accountId: string, includeArchived = false) {
  return prisma.volunteerRoleAssignment.findMany({
    where: { accountId, ...(includeArchived ? {} : { status: { not: 'archived' } }) },
    include: { pollingStation: true },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function setAccountPassword(accountId: string, passwordHash: string) {
  return prisma.volunteerAccount.update({
    where: { id: accountId },
    data: { passwordHash, activatedAt: new Date(), lastLoginAt: new Date(), loginFailureCount: 0, sessionVersion: { increment: 1 } },
  });
}

export async function recordAccountLoginSuccess(accountId: string) {
  return prisma.volunteerAccount.update({
    where: { id: accountId },
    data: { lastLoginAt: new Date(), loginFailureCount: 0 },
  });
}

export async function recordAccountLoginFailure(accountId: string) {
  return prisma.volunteerAccount.update({
    where: { id: accountId },
    data: { lastLoginFailedAt: new Date(), loginFailureCount: { increment: 1 } },
  });
}

export async function recordAccountInviteResult(accountId: string, sent: boolean) {
  return prisma.volunteerAccount.update({
    where: { id: accountId },
    data: sent
      ? { inviteDeliveryStatus: 'sent', inviteSentAt: new Date() }
      : { inviteDeliveryStatus: 'failed', inviteFailedAt: new Date() },
  });
}

export async function resetAccountAccess(accountId: string) {
  const accessToken = newAccessToken();
  const account = await prisma.volunteerAccount.update({
    where: { id: accountId },
    data: {
      accessToken,
      passwordHash: null,
      activatedAt: null,
      inviteDeliveryStatus: 'not_sent',
      sessionVersion: { increment: 1 },
    },
  });
  return { account, accessToken };
}

export async function updateRoleAssignmentStatus(id: string, status: string) {
  const assignment = await prisma.volunteerRoleAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.status === 'archived') return null;
  return prisma.volunteerRoleAssignment.update({
    where: { id },
    data: {
      status,
      ...(status === 'approved' && !assignment.approvedAt ? { approvedAt: new Date() } : {}),
    },
  });
}

export async function archiveRoleAssignment(id: string) {
  const assignment = await prisma.volunteerRoleAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.status === 'archived') return null;
  return prisma.volunteerRoleAssignment.update({
    where: { id },
    data: { status: 'archived', archivedAt: new Date(), statusBeforeArchive: assignment.status },
  });
}

export async function restoreRoleAssignment(id: string) {
  const assignment = await prisma.volunteerRoleAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.status !== 'archived') return null;
  return prisma.volunteerRoleAssignment.update({
    where: { id },
    data: { status: assignment.statusBeforeArchive || 'pending', archivedAt: null, statusBeforeArchive: null },
  });
}

export async function getVolunteerAccounts(options: PaginationOptions & { archived?: boolean } = {}) {
  const { page = 1, limit = 50, archived = false } = options;
  const assignmentWhere = archived ? { status: 'archived' } : { status: { not: 'archived' } };
  return prisma.volunteerAccount.findMany({
    where: { assignments: { some: assignmentWhere } },
    select: {
      ...accountSelect,
      assignments: { where: assignmentWhere, select: assignmentSelect, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function getAccountStipendStatus(accountId: string) {
  const [account, settings, approvedAssignments] = await Promise.all([
    prisma.volunteerAccount.findUnique({ where: { id: accountId } }),
    getSettings(),
    prisma.volunteerRoleAssignment.findMany({
      where: { accountId, status: 'approved' },
      select: { approvedAt: true, createdAt: true },
      orderBy: { approvedAt: 'asc' },
    }),
  ]);
  const activationDelayDays = Math.max(0, Number(settings.stipendActivationDelayDays) || 0);
  const repeatCooldownDays = STIPEND_REPEAT_COOLDOWN_DAYS;
  if (!account || approvedAssignments.length === 0) {
    return { canRequest: false, reason: 'Mobile-data stipend requests require at least one approved active role.', nextEligibleAt: null, latestRequest: null, activationDelayDays, repeatCooldownDays };
  }
  const activeSince = approvedAssignments[0].approvedAt || approvedAssignments[0].createdAt;
  const firstEligibleAt = new Date(activeSince.getTime() + activationDelayDays * DAY_MS);
  if (firstEligibleAt > new Date()) {
    return { canRequest: false, reason: `Mobile-data stipend requests become available after ${activationDelayDays} active day${activationDelayDays === 1 ? '' : 's'}.`, nextEligibleAt: firstEligibleAt, latestRequest: null, activationDelayDays, repeatCooldownDays };
  }
  const pending = await prisma.stipendRequest.findFirst({ where: { accountId, status: 'pending' }, orderBy: { requestedAt: 'desc' } });
  if (pending) return { canRequest: false, reason: 'A stipend request is already awaiting review.', nextEligibleAt: null, latestRequest: pending, activationDelayDays, repeatCooldownDays };
  const latestIssued = await prisma.stipendRequest.findFirst({ where: { accountId, status: { in: ['approved', 'paid'] } }, orderBy: { requestedAt: 'desc' } });
  if (!latestIssued) return { canRequest: true, reason: null, nextEligibleAt: null, latestRequest: null, activationDelayDays, repeatCooldownDays };
  const issuedAt = latestIssued.paidAt || latestIssued.approvedAt || latestIssued.requestedAt;
  const nextEligibleAt = new Date(issuedAt.getTime() + repeatCooldownDays * DAY_MS);
  return { canRequest: nextEligibleAt <= new Date(), reason: nextEligibleAt <= new Date() ? null : `Mobile-data stipends are available once every ${repeatCooldownDays} days after approval.`, nextEligibleAt: nextEligibleAt <= new Date() ? null : nextEligibleAt, latestRequest: latestIssued, activationDelayDays, repeatCooldownDays };
}

export async function createAccountStipendRequest(accountId: string) {
  return prisma.stipendRequest.create({ data: { volunteerId: accountId, accountId } });
}

export async function getAccountMobilizerDashboard(assignmentId: string) {
  const periodStart = currentWeekStartUtc();
  const [currentReport, recentReports, settings] = await Promise.all([
    prisma.mobilizerReport.findUnique({ where: { assignmentId_periodStart: { assignmentId, periodStart } } }),
    prisma.mobilizerReport.findMany({ where: { assignmentId }, orderBy: { periodStart: 'desc' }, take: 4 }),
    getSettings(),
  ]);
  return { groupLink: settings.mobilizerGroupLink || settings.whatsappLink || '', periodStart, currentReport, recentReports };
}

export async function createAssignmentMobilizerReport(assignmentId: string, data: {
  peopleReached: number; meetingsHeld: number; newVolunteers: number; keyIssues?: string; notes?: string;
}) {
  const periodStart = currentWeekStartUtc();
  try {
    return await prisma.mobilizerReport.create({ data: { volunteerId: assignmentId, assignmentId, periodStart, ...data } });
  } catch {
    return null;
  }
}

export async function getAccountStipendRequests(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  const requests = await prisma.stipendRequest.findMany({ where: { accountId: { not: null } }, orderBy: { requestedAt: 'desc' }, skip: (page - 1) * limit, take: limit });
  const accountIds = [...new Set(requests.map(request => request.accountId).filter(Boolean) as string[])];
  const accounts = await prisma.volunteerAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, email: true, phone: true } });
  const byId = new Map(accounts.map(account => [account.id, account]));
  return requests.map(request => ({ ...request, account: request.accountId ? byId.get(request.accountId) || null : null }));
}

export async function getAssignmentMobilizerReports(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  const reports = await prisma.mobilizerReport.findMany({ where: { assignmentId: { not: null } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit });
  const assignmentIds = [...new Set(reports.map(report => report.assignmentId).filter(Boolean) as string[])];
  const assignments = await prisma.volunteerRoleAssignment.findMany({ where: { id: { in: assignmentIds } }, include: { account: { select: { name: true, email: true, phone: true } } } });
  const byId = new Map(assignments.map(assignment => [assignment.id, assignment]));
  return reports.map(report => ({ ...report, assignment: report.assignmentId ? byId.get(report.assignmentId) || null : null }));
}

export async function getVolunteerAccountStats() {
  const [accounts, assignments] = await Promise.all([
    prisma.volunteerAccount.count({ where: { assignments: { some: { status: { not: 'archived' } } } } }),
    prisma.volunteerRoleAssignment.findMany({ where: { status: { not: 'archived' } }, select: { role: true } }),
  ]);
  return {
    totalAccounts: accounts,
    roleAssignments: assignments.length,
    pollingAgents: assignments.filter(assignment => assignment.role === 'polling_agent').length,
    mobilizers: assignments.filter(assignment => assignment.role === 'mobilizer').length,
    socialMedia: assignments.filter(assignment => assignment.role === 'social_media').length,
  };
}

// ---- Turbo polling station registry ----
export async function getPollingStations(includeInactive = false) {
  const stations = await prisma.pollingStation.findMany({
    where: includeInactive ? {} : { active: true, approvalStatus: 'approved' },
    orderBy: [{ ward: 'asc' }, { name: 'asc' }],
  });
  // Public polling-agent registration must only receive approved stations in the official ward set.
  // Admin views include legacy/manual/proposed entries so they can be reviewed.
  return includeInactive ? stations : stations.filter(station => isTurboWard(station.ward));
}

export async function getActiveTurboPollingStation(id: string) {
  const station = await prisma.pollingStation.findFirst({
    where: { id, active: true, approvalStatus: 'approved', county: TURBO_COUNTY, constituency: TURBO_CONSTITUENCY },
  });
  return station && isTurboWard(station.ward) ? station : null;
}

export async function addPollingStation(data: { name: string; ward: string }) {
  return prisma.pollingStation.create({
    data: { name: data.name.trim(), ward: data.ward.trim(), county: TURBO_COUNTY, constituency: TURBO_CONSTITUENCY },
  });
}

export async function setPollingStationActive(id: string, active: boolean) {
  try {
    const station = await prisma.pollingStation.findUnique({ where: { id } });
    if (!station || (active && station.approvalStatus !== 'approved')) return null;
    return await prisma.pollingStation.update({ where: { id }, data: { active } });
  } catch {
    return null;
  }
}

export async function proposePollingStation(data: { name: string; ward: string; proposedByEmail: string }) {
  const name = data.name.trim();
  const ward = data.ward.trim();
  const existing = await prisma.pollingStation.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ward: { equals: ward, mode: 'insensitive' } },
  });
  if (existing) return { station: existing, created: false };
  const station = await prisma.pollingStation.create({
    data: {
      name,
      ward,
      county: TURBO_COUNTY,
      constituency: TURBO_CONSTITUENCY,
      active: false,
      approvalStatus: 'pending',
      proposedByEmail: data.proposedByEmail,
      proposedAt: new Date(),
    },
  });
  return { station, created: true };
}

export async function updatePollingStationApproval(id: string, approvalStatus: 'approved' | 'rejected') {
  try {
    return await prisma.pollingStation.update({
      where: { id },
      data: {
        approvalStatus,
        active: approvalStatus === 'approved',
      },
    });
  } catch {
    return null;
  }
}

// ---- Private polling-day result reporting ----
export async function getElectionCandidates(includeInactive = false) {
  return prisma.electionCandidate.findMany({
    where: includeInactive ? {} : { active: true, archivedAt: null },
    orderBy: { name: 'asc' },
  });
}

export async function addElectionCandidate(data: { name: string; party?: string; imageUrl?: string }) {
  return prisma.electionCandidate.create({
    data: { name: data.name.trim(), party: data.party?.trim() || null, imageUrl: data.imageUrl?.trim() || null },
  });
}

export async function setElectionCandidateActive(id: string, active: boolean) {
  try {
    const candidate = await prisma.electionCandidate.findUnique({ where: { id } });
    if (!candidate || candidate.archivedAt) return null;
    return await prisma.electionCandidate.update({ where: { id }, data: { active } });
  } catch {
    return null;
  }
}

export async function archiveElectionCandidate(id: string) {
  try {
    const candidate = await prisma.electionCandidate.findUnique({ where: { id } });
    if (!candidate || candidate.archivedAt) return null;
    return await prisma.electionCandidate.update({
      where: { id },
      data: { archivedAt: new Date(), activeBeforeArchive: candidate.active, active: false },
    });
  } catch {
    return null;
  }
}

export async function restoreElectionCandidate(id: string) {
  try {
    const candidate = await prisma.electionCandidate.findUnique({ where: { id } });
    if (!candidate || !candidate.archivedAt) return null;
    return await prisma.electionCandidate.update({
      where: { id },
      data: { archivedAt: null, active: candidate.activeBeforeArchive ?? true, activeBeforeArchive: null },
    });
  } catch {
    return null;
  }
}

export async function getPollingResultForAssignment(assignmentId: string) {
  return prisma.pollingResultReport.findFirst({
    where: { assignmentId, status: { notIn: ['superseded', 'archived'] } },
    include: { attachments: true },
    orderBy: { revisionNumber: 'desc' },
  });
}

/** One unarchived result report per polling station at a time. */
export async function getActivePollingResultForStation(pollingStationId: string) {
  return prisma.pollingResultReport.findFirst({
    where: { pollingStationId, status: { notIn: ['superseded', 'archived'] } },
    orderBy: { revisionNumber: 'desc' },
  });
}

export async function createPollingResultReport(data: {
  assignmentId: string;
  pollingStationId: string;
  candidateVotesJson: string;
  validVotes: number;
  rejectedVotes: number;
  notes?: string;
  attachment: { objectKey: string; mimeType: string; originalName: string };
}) {
  const existingAssignmentResult = await getPollingResultForAssignment(data.assignmentId);
  const existingStationResult = await getActivePollingResultForStation(data.pollingStationId);
  if (existingAssignmentResult || existingStationResult) return null;
  const previousRevision = await prisma.pollingResultReport.findFirst({
    where: { assignmentId: data.assignmentId },
    orderBy: { revisionNumber: 'desc' },
    select: { revisionNumber: true },
  });
  const revisionNumber = (previousRevision?.revisionNumber || 0) + 1;
  return prisma.$transaction(async tx => {
    const report = await tx.pollingResultReport.create({
      data: {
        assignmentId: data.assignmentId,
        pollingStationId: data.pollingStationId,
        revisionNumber,
        candidateVotesJson: data.candidateVotesJson,
        validVotes: data.validVotes,
        rejectedVotes: data.rejectedVotes,
        notes: data.notes,
      },
    });
    await tx.pollingResultAttachment.create({
      data: { reportId: report.id, ...data.attachment },
    });
    return report;
  });
}

export async function getPollingResultReports(options: PaginationOptions = {}) {
  const { page = 1, limit = 50 } = options;
  return prisma.pollingResultReport.findMany({
    orderBy: { submittedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      attachments: true,
      pollingStation: { select: { id: true, name: true, ward: true, county: true, constituency: true } },
      assignment: { include: { account: { select: { id: true, name: true, email: true, phone: true } } } },
    },
  });
}

export async function getPollingResultAttachment(reportId: string, attachmentId: string) {
  return prisma.pollingResultAttachment.findFirst({ where: { id: attachmentId, reportId } });
}

export async function updatePollingResultStatus(id: string, status: 'under_review' | 'verified' | 'disputed', reviewNote?: string) {
  try {
    const report = await prisma.pollingResultReport.findUnique({ where: { id } });
    if (!report || report.status === 'archived') return null;
    return await prisma.pollingResultReport.update({
      where: { id },
      data: { status, reviewNote, reviewedAt: new Date() },
    });
  } catch {
    return null;
  }
}

// ---- Public campaign-verified polling results ----
// Never exposes agent identity, private evidence, internal notes, or unverified/disputed submissions.
export async function getPublicVerifiedPollingResults() {
  const verifiedReports = await prisma.pollingResultReport.findMany({
    where: { status: 'verified' },
    orderBy: [{ reviewedAt: 'desc' }, { submittedAt: 'desc' }],
    select: {
      id: true,
      pollingStationId: true,
      candidateVotesJson: true,
      validVotes: true,
      rejectedVotes: true,
      submittedAt: true,
      reviewedAt: true,
      pollingStation: { select: { name: true, ward: true } },
    },
  });

  const candidateRecords = await prisma.electionCandidate.findMany({
    select: { id: true, name: true, party: true, imageUrl: true, active: true, archivedAt: true },
  });
  const candidateRegistry = new Map(candidateRecords.map(candidate => [candidate.id, candidate]));

  // Only the newest verified report for each station contributes to public totals.
  const byStation = new Map<string, typeof verifiedReports[number]>();
  for (const report of verifiedReports) {
    if (!byStation.has(report.pollingStationId)) byStation.set(report.pollingStationId, report);
  }
  const reports = [...byStation.values()];

  const candidates = new Map<string, { id: string; name: string; party: string | null; imageUrl: string | null; votes: number }>();
  let totalValidVotes = 0;
  let totalRejectedVotes = 0;
  let lastUpdated: Date | null = null;

  for (const report of reports) {
    totalValidVotes += report.validVotes;
    totalRejectedVotes += report.rejectedVotes;
    const updated = report.reviewedAt || report.submittedAt;
    if (!lastUpdated || updated > lastUpdated) lastUpdated = updated;
    try {
      const votes = JSON.parse(report.candidateVotesJson) as { candidateId: string; candidateName: string; party?: string | null; votes: number }[];
      for (const vote of votes) {
        const registryCandidate = candidateRegistry.get(vote.candidateId);
        // Public results only show candidates that are currently active and not archived.
        // Deleted candidates have no registry row and are excluded as well.
        if (!registryCandidate || !registryCandidate.active || registryCandidate.archivedAt) continue;
        const current = candidates.get(vote.candidateId) || {
          id: vote.candidateId,
          name: registryCandidate.name,
          party: registryCandidate.party || vote.party || null,
          imageUrl: registryCandidate.imageUrl || null,
          votes: 0,
        };
        current.votes += Number(vote.votes) || 0;
        candidates.set(vote.candidateId, current);
      }
    } catch {
      // A malformed legacy snapshot is excluded from candidate totals but never breaks public results.
      logger.warn({ reportId: report.id }, 'Could not parse verified polling result candidate snapshot');
    }
  }

  return {
    verifiedStations: reports.length,
    totalValidVotes,
    totalRejectedVotes,
    lastUpdated,
    candidates: [...candidates.values()].sort((a, b) => b.votes - a.votes),
    stations: reports.map(report => ({
      station: report.pollingStation.name,
      ward: report.pollingStation.ward,
      validVotes: report.validVotes,
      rejectedVotes: report.rejectedVotes,
      verifiedAt: report.reviewedAt || report.submittedAt,
    })).sort((a, b) => a.ward.localeCompare(b.ward) || a.station.localeCompare(b.station)),
  };
}

export async function archivePollingResultReport(id: string, archivedBy: string, archiveNote?: string) {
  try {
    const report = await prisma.pollingResultReport.findUnique({ where: { id } });
    if (!report || report.status === 'archived') return null;
    return await prisma.pollingResultReport.update({
      where: { id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        archivedBy,
        archiveNote: archiveNote?.trim() || null,
      },
    });
  } catch {
    return null;
  }
}

/** Permanently delete a candidate registry entry. Historical result snapshots retain name/vote data. */
export async function deleteElectionCandidate(id: string) {
  try {
    await prisma.electionCandidate.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
