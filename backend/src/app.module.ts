import { Module } from '@nestjs/common';
import { FileModule } from './file/file.module';
import { AIModule } from './ai/ai.module';
import { PaymentModule } from './payment/payment.module';
import { PrismaModule } from './prisma/prisma.module';
import { TelegramModule } from './telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    FileModule,
    AIModule,
    PaymentModule,
    // Telegram webhook handling
    TelegramModule,
  ],
})
export class AppModule {}
