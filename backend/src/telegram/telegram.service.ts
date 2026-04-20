import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private token = process.env.TELEGRAM_BOT_TOKEN || '';

  async sendMessage(chatId: number | string, text: string) {
    if (!this.token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set; cannot send message');
      return null;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      return res.json().catch(() => null);
    } catch (e) {
      this.logger.error('Failed to send Telegram message', e as any);
      return null;
    }
  }
}
