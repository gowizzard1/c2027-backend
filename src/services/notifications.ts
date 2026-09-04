import axios from 'axios';

/**
 * Send SMS via Africa's Talking API
 */
export async function sendSMS(phone: string, message: string): Promise<void> {
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;

  const isConfigured = apiKey && username &&
    !apiKey.startsWith('your_') && !username.startsWith('your_');

  if (!isConfigured) {
    console.log('[SMS Mock] To:', phone, '\n[SMS Mock] Message:', message);
    return;
  }

  try {
    await axios.post(
      'https://api.africastalking.com/version1/messaging',
      new URLSearchParams({
        username,
        to: formatPhone(phone),
        message,
        from: process.env.AT_SENDER_ID || '',
      }),
      {
        headers: {
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log(`[SMS] Sent to ${phone}`);
  } catch (error) {
    console.error('[SMS] Failed to send:', error);
  }
}

/**
 * Send WhatsApp message via Meta WhatsApp Business API
 */
export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  const isConfigured = token && phoneId &&
    !token.startsWith('your_') && !phoneId.startsWith('your_');

  if (!isConfigured) {
    console.log('[WhatsApp Mock] To:', phone, '\n[WhatsApp Mock] Message:', message);
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: formatPhone(phone),
        type: 'text',
        text: { body: message },
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    console.log(`[WhatsApp] Sent to ${phone}`);
  } catch (error) {
    console.error('[WhatsApp] Failed to send:', error);
  }
}

/**
 * Send donation confirmation via both SMS and WhatsApp
 */
export async function sendDonationConfirmation(params: {
  phone: string;
  name: string;
  amount: number;
  receiptId: string;
}) {
  const message = `Dear ${params.name}, thank you for your generous donation of KES ${params.amount.toLocaleString()} to Campaign 2027! Receipt: ${params.receiptId}. Together we rise! 🇰🇪`;

  await Promise.allSettled([
    sendSMS(params.phone, message),
    sendWhatsApp(params.phone, message),
  ]);
}

/**
 * Send volunteer registration confirmation
 */
export async function sendVolunteerConfirmation(params: {
  phone: string;
  name: string;
  role: string;
}) {
  const message = `Welcome aboard, ${params.name}! You've been registered as a ${params.role} for Campaign 2027. Our team will reach out soon with next steps. Together we rise! 🇰🇪`;

  await Promise.allSettled([
    sendSMS(params.phone, message),
    sendWhatsApp(params.phone, message),
  ]);
}

/**
 * Send order confirmation
 */
export async function sendOrderConfirmation(params: {
  phone: string;
  name: string;
  total: number;
  orderId: string;
}) {
  const message = `Hi ${params.name}, your merchandise order (${params.orderId}) of KES ${params.total.toLocaleString()} has been received! We'll notify you once it's ready for pickup/delivery. Campaign 2027 🇰🇪`;

  await Promise.allSettled([
    sendSMS(params.phone, message),
    sendWhatsApp(params.phone, message),
  ]);
}

function formatPhone(phone: string): string {
  let formatted = phone.replace(/\s/g, '');
  if (formatted.startsWith('0')) {
    formatted = '+254' + formatted.slice(1);
  } else if (!formatted.startsWith('+')) {
    formatted = '+' + formatted;
  }
  return formatted;
}
