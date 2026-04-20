import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreateLinkDto } from './dto/create-link.dto';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-link')
  async createLink(@Body() dto: CreateLinkDto) {
    return this.paymentService.createCheckoutLink(dto);
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: any, @Headers('x-payos-signature') signature: string) {
    const ok = await this.paymentService.verifyWebhook(body, signature);
    if (!ok) {
      return { ok: false };
    }
    return { ok: true };
  }
}
