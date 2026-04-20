import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { FileService } from '../file/file.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly fileService: FileService, private readonly prisma: PrismaService) {}

  async createCheckoutLink(order: any) {
    const payosUrl = process.env.PAYOS_BASE_URL;
    const clientId = process.env.PAYOS_MERCHANT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    const checksumKey = process.env.PAYOS_WEBHOOK_SECRET;

    if (!payosUrl || !clientId || !apiKey) {
      const mock = `https://payos.example/checkout?amount=${order.total}&mock=1`;
      return { checkoutUrl: mock };
    }

    const orderCode = Math.floor(Date.now() / 1000); // use seconds for smaller integer
    let amount = Math.round(order.total || 0);
    const description = `TSOrder${String(orderCode).slice(-6)}`.slice(0, 25);
    const cancelUrl = `${process.env.FRONTEND_URL}/payment-status?status=cancel`;
    const returnUrl = `${process.env.FRONTEND_URL}/payment-status?status=success`;
    const notifyUrl = `${process.env.BACKEND_URL || 'http://localhost:3001'}/payment/webhook`;

    // Resolve unit prices from menu when possible and compute accurate amount
    const canonMap: Record<string, any> = { amount, cancelUrl, description, orderCode, returnUrl };
    const keys = Object.keys(canonMap).sort();

    let itemsDetailed: Array<any> = [];
    try {
      const menu = await this.fileService.getMenu();
      itemsDetailed = (order.items || []).map((it: any) => {
        let unitPrice = 0;
        try {
          if (it.item_id) {
            const found = menu.find((m) => (m.item_id || '').toString() === (it.item_id || '').toString() || (m.name || '').toLowerCase() === (it.name || '').toLowerCase());
            if (found) {
              unitPrice = (it.size && String(it.size).toUpperCase() === 'L') ? (found.price_l || found.price_m) : (found.price_m || found.price_l);
            }
          } else {
            const found = menu.find((m) => (m.name || '').toLowerCase().trim() === (it.name || '').toLowerCase().trim());
            if (found) unitPrice = (it.size && String(it.size).toUpperCase() === 'L') ? (found.price_l || found.price_m) : (found.price_m || found.price_l);
          }
        } catch (e) {
          unitPrice = 0;
        }
        const quantity = Number(it.quantity || 1);
        return { name: it.name, item_id: it.item_id, size: it.size, quantity, unitPrice: Math.round(unitPrice || 0), total: Math.round((unitPrice || 0) * quantity) };
      });
    } catch (e) {
      this.logger.debug('Could not resolve menu prices: ' + String(e));
      itemsDetailed = (order.items || []).map((it: any) => ({ name: it.name, item_id: it.item_id, size: it.size, quantity: Number(it.quantity || 1), unitPrice: 0, total: 0 }));
    }

    const computedAmount = itemsDetailed.reduce((s, it) => s + (Number(it.total) || 0), 0);
    if (computedAmount > 0) {
      // Trust computed amount from menu prices
      // eslint-disable-next-line prefer-const
      amount = computedAmount;
    }

    // Persist order in DB (best-effort)
    let dbOrder: any = null;
    try {
      dbOrder = await this.prisma.order.create({
        data: {
          orderCode,
          amount,
          description,
          status: 'PENDING',
          items: {
            create: itemsDetailed.map((i) => ({
              itemId: i.item_id ?? null,
              name: i.name ?? '',
              size: i.size ?? null,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              total: i.total,
            })),
          },
        },
      });
    } catch (e) {
      this.logger.debug('Could not persist order to DB: ' + String(e));
    }

    // Build canonical string strictly per PayOS v2 docs and sign with checksum key
    const signMap: Record<string, any> = { amount, cancelUrl, description, orderCode, returnUrl };
    const sortedKeys = Object.keys(signMap).sort();

    const convertValue = (v: any) => {
      if (v === null || v === undefined || v === 'null' || v === 'undefined') return '';
      if (Array.isArray(v)) return JSON.stringify(v.map((el) => (el && typeof el === 'object' ? this.sortObjDataByKey(el) : el)));
      if (typeof v === 'object') return JSON.stringify(this.sortObjDataByKey(v));
      return v;
    };

    const canonical = sortedKeys
      .map((k) => `${k}=${convertValue(signMap[k])}`)
      .join('&');

    if (!checksumKey) {
      this.logger.error('PAYOS_WEBHOOK_SECRET (checksum key) is missing — cannot compute v2 signature');
      return { checkoutUrl: null, error: 'Missing PAYOS_WEBHOOK_SECRET' };
    }

    const signature = crypto.createHmac('sha256', checksumKey).update(canonical).digest('hex');

    const bodyPayload: any = {
      orderCode,
      amount,
      description,
      cancelUrl,
      returnUrl,
      items: itemsDetailed.map((i) => ({ name: i.name, quantity: i.quantity, price: i.unitPrice })),
      signature,
    };

    try {
      this.logger.debug(`PayOS v2 canonical: ${canonical}`);
      const res = await fetch(`${payosUrl}/v2/payment-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-api-key': apiKey,
        },
        body: JSON.stringify(bodyPayload),
      });

      const bodyResp = await res.json().catch(async () => ({ text: await res.text() }));
      this.logger.log(`PayOS v2 response: ${JSON.stringify(bodyResp).slice(0, 400)}`);

      const checkoutUrl = bodyResp?.data?.checkoutUrl ?? bodyResp?.data?.url ?? bodyResp?.checkoutUrl ?? bodyResp?.url ?? null;
      const ok = (res.status >= 200 && res.status < 300) && (checkoutUrl || bodyResp?.code === '00' || bodyResp?.code === 0);
      if (ok) {
        // save payment record (best-effort)
        try {
          await this.prisma.payment.create({
            data: {
              orderId: dbOrder?.id ?? undefined,
              payosPaymentLinkId: bodyResp?.data?.paymentLinkId ?? null,
              checkoutUrl: checkoutUrl ?? null,
              signature: signature ?? null,
              status: 'PENDING',
            },
          });
        } catch (e) {
          this.logger.debug('Could not persist payment record: ' + String(e));
        }
        return { checkoutUrl, raw: bodyResp, method: 'v2-canonical' };
      }
      return { checkoutUrl: null, raw: bodyResp, method: 'v2-canonical' };
    } catch (err) {
      this.logger.error('PayOS v2 request failed', err as any);
      return { checkoutUrl: null, error: String(err) };
    }
  }

  async verifyWebhook(body: any, signatureHeader?: string) {
    const secret = process.env.PAYOS_WEBHOOK_SECRET;
    if (!secret) return false;

    const incoming = signatureHeader ?? body?.signature;
    if (!incoming) return false;

    // PayOS webhook: sort `data` keys and convert to query string per docs, then HMAC_SHA256
    const dataToSign = body?.data ?? body;
    const query = this.convertObjToQueryStr(this.sortObjDataByKey(dataToSign));
    const computed = crypto.createHmac('sha256', secret).update(query).digest('hex');
    const verified = computed === incoming;

    // persist webhook log (best-effort)
    try {
      await this.prisma.webhookLog.create({
        data: {
          orderCode: body?.data?.orderCode ?? null,
          payload: body,
          signature: incoming,
          verified,
        },
      });
    } catch (e) {
      this.logger.debug('Could not persist webhook log: ' + String(e));
    }

    return verified;
  }

  private sortObjDataByKey(object: any): any {
    if (object === null || object === undefined) return object;
    if (Array.isArray(object)) {
      return object.map((v) => (v && typeof v === 'object' ? this.sortObjDataByKey(v) : v));
    }
    if (typeof object !== 'object') return object;

    return Object.keys(object)
      .sort()
      .reduce((acc: any, key: string) => {
        const value = object[key];
        if (Array.isArray(value)) {
          acc[key] = value.map((item) => (item && typeof item === 'object' ? this.sortObjDataByKey(item) : item));
        } else if (value && typeof value === 'object') {
          acc[key] = this.sortObjDataByKey(value);
        } else {
          acc[key] = value;
        }
        return acc;
      }, {});
  }

  private convertObjToQueryStr(object: any): string {
    if (object === null || object === undefined) return '';
    const parts: string[] = [];
    for (const key of Object.keys(object)) {
      const value = object[key];
      let v: any = value;
      if (v === null || v === undefined) v = '';
      if (Array.isArray(v)) {
        v = JSON.stringify(v.map((el) => (el && typeof el === 'object' ? this.sortObjDataByKey(el) : el)));
      } else if (v && typeof v === 'object') {
        v = JSON.stringify(this.sortObjDataByKey(v));
      }
      parts.push(`${key}=${v}`);
    }
    return parts.join('&');
  }
}
