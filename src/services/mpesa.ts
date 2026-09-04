import axios from 'axios';

function getBaseUrl() {
  return (process.env.MPESA_ENV || 'sandbox') === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function isConfigured(): boolean {
  const key = process.env.MPESA_CONSUMER_KEY || '';
  const secret = process.env.MPESA_CONSUMER_SECRET || '';
  const passkey = process.env.MPESA_PASSKEY || '';
  return !!(key && secret && passkey &&
    !key.startsWith('your_') &&
    !secret.startsWith('your_') &&
    !passkey.startsWith('your_'));
}

async function getToken(): Promise<string> {
  const key = process.env.MPESA_CONSUMER_KEY!;
  const secret = process.env.MPESA_CONSUMER_SECRET!;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await axios.get(`${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return res.data.access_token;
}

function formatPhone(phone: string): string {
  let p = phone.replace(/\s+/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  return p;
}

export interface STKPushParams {
  phone: string;
  amount: number;
  accountRef: string;
  description: string;
}

export interface STKResult {
  CheckoutRequestID: string;
  MerchantRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
  mock?: boolean;
}

/** Real M-Pesa STK Push */
export async function initiateSTKPush(params: STKPushParams): Promise<STKResult> {
  if (!isConfigured()) throw new Error('M-Pesa credentials not configured');

  const token = await getToken();
  const shortcode = process.env.MPESA_SHORTCODE!;
  const passkey = process.env.MPESA_PASSKEY!;
  const callbackUrl = process.env.MPESA_CALLBACK_URL!;

  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const res = await axios.post(
    `${getBaseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(params.amount),
      PartyA: formatPhone(params.phone),
      PartyB: shortcode,
      PhoneNumber: formatPhone(params.phone),
      CallBackURL: callbackUrl,
      AccountReference: params.accountRef,
      TransactionDesc: params.description,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return res.data;
}

/** Mock STK Push — simulates a successful push instantly */
export async function mockSTKPush(params: STKPushParams): Promise<STKResult> {
  console.log(`[M-Pesa MOCK] STK Push → ${params.phone}, KES ${params.amount}`);
  await new Promise(r => setTimeout(r, 800)); // simulate latency
  return {
    CheckoutRequestID: `MOCK-${Date.now()}`,
    MerchantRequestID: `MOCK-MR-${Date.now()}`,
    ResponseCode: '0',
    ResponseDescription: 'Success. Request accepted for processing',
    CustomerMessage: 'Success. Request accepted for processing',
    mock: true,
  };
}

export { isConfigured as isMpesaConfigured };
