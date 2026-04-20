import { Controller, Post, Body } from '@nestjs/common';
import { AIService } from './ai.service';
import { ParseOrderDto } from './dto/parse-order.dto';

@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Post('parse-order')
  async parseOrder(@Body() body: ParseOrderDto) {
    return this.aiService.parseOrder(body.text);
  }
}
