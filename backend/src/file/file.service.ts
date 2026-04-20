import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'csv-parser';
import Redis from 'ioredis';

export interface MenuItem {
  category: string;
  item_id: string;
  name: string;
  description?: string;
  price_m: number;
  price_l: number;
  available: boolean;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private redis: Redis;
  private menuCacheKey = 'menu:items';

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL);
    this.ensureMenuLoaded().catch((e) => this.logger.error(e));
  }

  async ensureMenuLoaded() {
    const exists = await this.redis.exists(this.menuCacheKey);
    if (!exists) {
      this.logger.log('Loading menu CSV into Redis cache...');
      const menu = await this.loadMenuFromCsv();
      await this.redis.set(this.menuCacheKey, JSON.stringify(menu));
      this.logger.log(`Cached ${menu.length} menu items`);
    }
  }

  async loadMenuFromCsv(): Promise<MenuItem[]> {
    const results: MenuItem[] = [];
    const csvPath = path.join(__dirname, '..', 'data', 'menu.csv');
    return new Promise<MenuItem[]>((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (data) => {
          try {
            results.push({
              category: (data.category || '').toString(),
              item_id: (data.item_id || data.itemId || data.ITEM_ID || '').toString(),
              name: (data.name || data.Name || data.item || '').toString(),
              description: (data.description || '').toString(),
              price_m: Number(data.price_m || data.priceM || data.price_m || 0),
              price_l: Number(data.price_l || data.priceL || data.price_l || 0),
              available: String(data.available || '').toLowerCase() === 'true' || data.available === true,
            });
          } catch (e) {
            // ignore malformed rows
          }
        })
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  async getMenu(): Promise<MenuItem[]> {
    const raw = await this.redis.get(this.menuCacheKey);
    if (raw) {
      return JSON.parse(raw) as MenuItem[];
    }
    const menu = await this.loadMenuFromCsv();
    await this.redis.set(this.menuCacheKey, JSON.stringify(menu));
    return menu;
  }
}
