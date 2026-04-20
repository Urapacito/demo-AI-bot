import { IsString } from 'class-validator';

export class ParseOrderDto {
  @IsString()
  text: string;
}
