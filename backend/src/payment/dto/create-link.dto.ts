import { IsNumber, IsArray, ValidateNested, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsString()
  name: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  size?: string; // M or L

  @IsOptional()
  @IsString()
  item_id?: string;

  @IsOptional()
  @IsString()
  sugar?: string;

  @IsOptional()
  @IsString()
  ice?: string;
}

export class CreateLinkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsNumber()
  total: number;

  @IsString()
  address: string;
}
