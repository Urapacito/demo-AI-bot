"use client"
import { useState } from 'react';

export default function ChatInterface({ setOrder }) {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);

  async function send() {
    const res = await fetch((process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001') + '/ai/parse-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setMessages((m) => [...m, { from: 'user', text }, { from: 'bot', text: JSON.stringify(data) }]);
    if (!data.invalidItems || data.invalidItems.length === 0) {
      setOrder(data);
    }
    setText('');
  }

  return (
    <div>
      <div style={{ border: '1px solid #ddd', height: 200, overflow: 'auto' }}>
        {messages.map((m, i) => (
          <div key={i}><b>{m.from}:</b> {m.text}</div>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={send}>Gửi</button>
    </div>
  );
}
