"use client"
import { useState } from 'react';
import ChatInterface from './components/ChatInterface';
import OrderSummary from './components/OrderSummary';

export default function Page() {
  const [order, setOrder] = useState(null);
  return (
    <main style={{ padding: 20 }}>
      <h1>Quán Trà Sữa - Chat</h1>
      <ChatInterface setOrder={setOrder} />
      <OrderSummary order={order} />
    </main>
  );
}
