Frontend (Next.js) demo

- Run: `npm install` then `npm run dev`
- Set `NEXT_PUBLIC_BACKEND_URL` in `.env` to point to the NestJS backend

UI parts:
- ChatInterface: gửi text tới `POST /ai/parse-order`
- OrderSummary: hiển thị đơn và gọi `POST /payment/create-link`
