const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readChecksumKey() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*PAYOS_WEBHOOK_SECRET\s*=\s*(.*)\s*$/i);
      if (m) {
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        return v;
      }
    }
  }
  if (process.env.PAYOS_WEBHOOK_SECRET) return process.env.PAYOS_WEBHOOK_SECRET;
  console.error('PAYOS_WEBHOOK_SECRET not found in backend/.env or env');
  process.exit(1);
}

function sortObjDataByKey(object) {
  if (object === null || object === undefined) return object;
  if (Array.isArray(object)) return object.map((v) => (v && typeof v === 'object' ? sortObjDataByKey(v) : v));
  if (typeof object !== 'object') return object;
  return Object.keys(object)
    .sort()
    .reduce((acc, key) => {
      const value = object[key];
      if (Array.isArray(value)) acc[key] = value.map((item) => (item && typeof item === 'object' ? sortObjDataByKey(item) : item));
      else if (value && typeof value === 'object') acc[key] = sortObjDataByKey(value);
      else acc[key] = value;
      return acc;
    }, {});
}

function convertObjToQueryStr(object) {
  if (object === null || object === undefined) return '';
  const parts = [];
  for (const key of Object.keys(object)) {
    let v = object[key];
    if (v === null || v === undefined) v = '';
    if (Array.isArray(v)) v = JSON.stringify(v.map((el) => (el && typeof el === 'object' ? sortObjDataByKey(el) : el)));
    else if (v && typeof v === 'object') v = JSON.stringify(sortObjDataByKey(v));
    parts.push(`${key}=${v}`);
  }
  return parts.join('&');
}

async function main() {
  const secret = readChecksumKey();

  const data = {
    orderCode: 1776673392,
    amount: 35000,
    description: 'Test webhook TS order',
    accountNumber: '1234567890',
    reference: 'TESTREF123',
    transactionDateTime: new Date().toISOString(),
    currency: 'VND',
    paymentLinkId: 'test-payment-link',
    code: '00',
    desc: 'Thành công',
  };

  const body = { code: '00', desc: 'success', success: true, data };

  const sorted = sortObjDataByKey(body.data);
  const query = convertObjToQueryStr(sorted);
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');

  console.log('Canonical string to sign:\n', query);
  console.log('Computed signature:', signature);

  const url = process.env.WEBHOOK_TARGET || 'http://localhost:3001/payment/webhook';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-payos-signature': signature },
    body: JSON.stringify(body),
  });

  console.log('Response status:', res.status);
  const text = await res.text();
  console.log('Response body:\n', text);
}

main().catch((e) => { console.error(e); process.exit(1); });
