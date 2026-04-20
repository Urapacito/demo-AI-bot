import { Injectable, Logger } from '@nestjs/common';
import { FileService, MenuItem } from '../file/file.service';
import OpenAI from 'openai';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private openai: any;

  constructor(private readonly fileService: FileService) {
    const key = process.env.OPENAI_API_KEY || '';
    // Only initialize OpenAI client when key is not a Google API key
    if (key && !key.startsWith('AIza')) {
      this.openai = new OpenAI({ apiKey: key });
    } else {
      this.openai = null;
    }
  }

  async parseOrder(text: string) {
    const menu = await this.fileService.getMenu();

    // build a readable menu list for the LLM
    const menuText = menu
      .map((m) => `${m.item_id} - ${m.name} - M:${m.price_m} L:${m.price_l}`)
      .join('\n');

    const systemPrompt = `Bạn là trợ lý ảo thân thiện của một quán trà sữa. Sau đây là menu (mỗi dòng: item_id - tên - M:giá L:giá):\n${menuText}\n\nKhi khách nói, chỉ tư vấn/công nhận món có trong menu. Nếu khách gọi món ngoài menu, trả về chúng trong danh sách \"invalidItems\".\n\nPHẢI TRẢ LẠI DUY NHẤT MỘT JSON HỢP LỆ với cấu trúc:\n{\n  "items": [{"item_id":"(nếu có)", "name":"", "size":"M|L", "quantity":1, "sugar":"", "ice":""}],\n  "address":"(nếu có)",\n  "notes":"(optional)",\n  "total": null\n}\n\nLuôn để trường \"total\" là null — server sẽ tính lại dựa trên giá trong menu. Chỉ trả về JSON, KHÔNG kèm giải thích.`;

    const userPrompt = `User: ${text}\nRespond only with the JSON object described.`;

    // Support both OpenAI and Google Generative API (Gemini).
    const apiKey = process.env.OPENAI_API_KEY || '';
    let content = '';

    if (apiKey.startsWith('AIza')) {
      // Use Google Generative Language API (generateContent) via AI Studio API key
      const googleModel = process.env.GOOGLE_MODEL || 'gemini-flash-latest';
      // Use v1beta endpoint and generateContent which matches AI Studio quickstart
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent`;
      const promptText = `${systemPrompt}\n\n${userPrompt}`;
      const body = {
        contents: [
          {
            parts: [
              {
                text: promptText,
              },
            ],
          },
        ],
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));

        // Try several common response shapes to extract text
        const tryExtract = (obj: any): string => {
          if (!obj) return '';
          if (typeof obj === 'string') return obj;

          // Common Google GenAI shape: { candidates: [ { content: { parts: [{text: "..."}] } } ] }
          if (obj.candidates && obj.candidates.length) {
            const c = obj.candidates[0];
            // content may be a string
            if (typeof c.content === 'string') return c.content;
            // content may be an object with `parts` array where each part has `text`
            if (c.content && Array.isArray(c.content.parts) && c.content.parts.length) {
              return c.content.parts.map((p: any) => p.text || '').join('');
            }
            // content may itself be an array of strings
            if (Array.isArray(c.content) && c.content.length && typeof c.content[0] === 'string') return c.content[0];
            // fallback: check output field on candidate
            if (c.output && Array.isArray(c.output) && c.output.length) {
              const o = c.output[0];
              if (typeof o.content === 'string') return o.content;
              if (o.content && Array.isArray(o.content) && o.content.length) {
                if (typeof o.content[0].text === 'string') return o.content.map((p: any) => p.text).join('');
                if (typeof o.content[0] === 'string') return o.content.join('');
              }
            }
          }

          // Older or alternate shape: { output: [ { content: [...] } ] }
          if (obj.output && Array.isArray(obj.output) && obj.output.length) {
            const o = obj.output[0];
            if (typeof o.content === 'string') return o.content;
            if (o.content && Array.isArray(o.content) && o.content.length) {
              if (typeof o.content[0].text === 'string') return o.content.map((p: any) => p.text).join('');
              if (typeof o.content[0] === 'string') return o.content.join('');
            }
          }

          if (obj.result && typeof obj.result === 'string') return obj.result;
          return '';
        };

        content = tryExtract(json);
        if (!content) {
          this.logger.error('Google generative API returned unexpected response: ' + JSON.stringify(json));
          throw new Error('Google generative API returned unexpected response');
        }
      } catch (e) {
        this.logger.error('Google generative API call failed', e as any);
        throw e;
      }
    } else {
      if (!this.openai) throw new Error('OpenAI client not initialized (missing OPENAI_API_KEY)');
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 800,
      });
      content = response.choices?.[0]?.message?.content ?? response.choices?.[0]?.text ?? '';
    }

    let parsed: any = { items: [], address: null, notes: null, total: null };
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // try to extract JSON substring
      const m = content.match(/\{[\s\S]*\}/m);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch (e2) {
          this.logger.error('Failed to parse JSON from model response');
          throw e2;
        }
      } else {
        this.logger.error('Model did not return JSON');
        throw e;
      }
    }

    const invalidItems: string[] = [];
    let total = 0;

    const normalizeSize = (s: any) => {
      if (!s) return 'M';
      const t = String(s).toLowerCase();
      if (t.includes('l') || t.includes('lớn') || t.includes('large')) return 'L';
      return 'M';
    };

    const findMenuItem = (it: any): MenuItem | undefined => {
      const name = (it.name || '').toString().trim().toLowerCase();
      const id = (it.item_id || it.itemId || '').toString().trim().toLowerCase();
      let found = undefined;
      if (id) found = menu.find((m) => m.item_id.toLowerCase() === id);
      if (!found && name) found = menu.find((m) => m.name.toLowerCase() === name);
      if (!found && name) found = menu.find((m) => m.name.toLowerCase().includes(name) || m.item_id.toLowerCase().includes(name));
      return found;
    };

    for (const it of parsed.items || []) {
      const found = findMenuItem(it);
      if (!found) {
        invalidItems.push(it.name || it.item_id || JSON.stringify(it));
        continue;
      }
      const size = normalizeSize(it.size);
      const qty = Number(it.quantity || 1);
      const price = size === 'L' ? (found.price_l || found.price_m) : (found.price_m || found.price_l || 0);
      total += price * qty;
    }

    parsed.total = total;
    if (invalidItems.length) parsed.invalidItems = invalidItems;
    return parsed;
  }
}
