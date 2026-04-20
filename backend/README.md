Backend (NestJS) scaffold

- Run: `npm install` then `npm run start` (dev uses ts-node)
- Configure environment variables via `.env` (see `.env.example`)

Modules included:
- FileModule: đọc `src/data/menu.csv` và cache vào Redis
- AIModule: gọi OpenAI để parse order và validate so với menu
- PaymentModule: endpoint `POST /payment/create-link` và `POST /payment/webhook` (checksum)
