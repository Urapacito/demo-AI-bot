import { Controller, Get } from '@nestjs/common';
import { FileService } from './file.service';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('menu')
  async getMenu() {
    return this.fileService.getMenu();
  }
}
