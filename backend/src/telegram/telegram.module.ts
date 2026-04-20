import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { AIModule } from '../ai/ai.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [AIModule, PaymentModule],
  providers: [TelegramService],
  controllers: [TelegramController],
})
export class TelegramModule {}
