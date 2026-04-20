import { Controller, Post, Body, Headers, Logger, HttpCode } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AIService } from '../ai/ai.service';
import { PaymentService } from '../payment/payment.service';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);
  private readonly secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  constructor(private readonly telegram: TelegramService, private readonly ai: AIService, private readonly payment: PaymentService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: any, @Headers('x-telegram-bot-api-secret-token') secretHeader: string) {
    // optional secret check
    if (this.secret && this.secret !== secretHeader) {
      this.logger.warn('Telegram webhook secret mismatch');
      return { ok: false };
    }

    try {
      const update = body || {};
      const message = update.message ?? update.edited_message ?? null;
      if (!message) return { ok: true };

      const chatId = message.chat?.id;
      const text = message.text || '';

      if (!text) {
        await this.telegram.sendMessage(chatId, 'Vui lòng gửi tin nhắn văn bản để đặt hàng.');
        return { ok: true };
      }

      // parse order using AI service
      const parsed = await this.ai.parseOrder(text);

      // create payment link
      const linkResp = await this.payment.createCheckoutLink(parsed);
      const checkoutUrl = linkResp.checkoutUrl || linkResp.raw?.data?.checkoutUrl;

      if (checkoutUrl) {
        await this.telegram.sendMessage(chatId, `Đã tạo link thanh toán: ${checkoutUrl}`);
      } else {
        await this.telegram.sendMessage(chatId, `Không thể tạo link thanh toán: ${JSON.stringify(linkResp)}`);
      }
    } catch (e) {
      this.logger.error('Telegram webhook handling failed', e as any);
    }
    return { ok: true };
  }
}
