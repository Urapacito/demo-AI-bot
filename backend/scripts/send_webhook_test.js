const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

(async () => {
  const envPath = path.join(__dirname, '..', '.env');
  let secret = process.env.PAYOS_WEBHOOK_SECRET;
  try {
    if (!secret && fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf8');
      const m = env.split(/\r?\n/).find(l => l && l.startsWith('PAYOS_WEBHOOK_SECRET='));
      if (m) secret = m.split('=')[1].trim();
    }
  } catch (e) {}
  if (!secret) {
    console.error('PAYOS_WEBHOOK_SECRET not found in process.env or ../.env');
    process.exit(1);
  }

  const payload = {
    code: '00',
    desc: 'success',
    success: true,
    data: {
      orderCode: Math.floor(Date.now() / 1000),
      amount: 35000,
      description: 'Test webhook from script',
      accountNumber: '12345678',
      reference: 'TEST123',
      transactionDateTime: new Date().toISOString(),
      currency: 'VND',
      paymentLinkId: 'test-id',
      code: '00',
      desc: 'Thành công',
      counterAccountBankId: '',
      counterAccountBankName: '',
      counterAccountName: '',
      counterAccountNumber: '',
      virtualAccountName: '',
      virtualAccountNumber: ''
    }
  };

  function sortObjDataByKey(object) {
    if (object === null || object === undefined) return object;
    if (Array.isArray(object)) {
      return object.map((v) => (v && typeof v === 'object' ? sortObjDataByKey(v) : v));
    }
    if (typeof object !== 'object') return object;
    return Object.keys(object)
      .sort()
      .reduce((acc, key) => {
        const value = object[key];
        if (Array.isArray(value)) {
          acc[key] = value.map((item) => (item && typeof item === 'object' ? sortObjDataByKey(item) : item));
        } else if (value && typeof value === 'object') {
          acc[key] = sortObjDataByKey(value);
        } else {
          acc[key] = value;
        }
        return acc;
      }, {});
  }

  function convertObjToQueryStr(object) {
    if (object === null || object === undefined) return '';
    const parts = [];
    for (const key of Object.keys(object)) {
      const value = object[key];
      let v = value;
      if (v === null || v === undefined) v = '';
      if (Array.isArray(v)) {
        v = JSON.stringify(v.map((el) => (el && typeof el === 'object' ? sortObjDataByKey(el) : el)));
      } else if (v && typeof v === 'object') {
        v = JSON.stringify(sortObjDataByKey(v));
      }
      parts.push(`${key}=${v}`);
    }
    return parts.join('&');
  }

  const dataToSign = convertObjToQueryStr(sortObjDataByKey(payload.data));
  const signature = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');

  const url = 'http://localhost:3001/payment/webhook';
  console.log('POST', url);
  console.log('dataToSign:', dataToSign);
  console.log('signature:', signature);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-payos-signature': signature,
    },
    body: JSON.stringify(payload),
  });
  console.log('HTTP', res.status);
  const text = await res.text();
  try {
    console.log(JSON.parse(text));
  } catch (e) {
    console.log(text);
  }
})().catch(err => { console.error(err); process.exit(1); });
