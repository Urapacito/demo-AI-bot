"use client"
export default function OrderSummary({ order }) {
  async function pay() {
    const res = await fetch((process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001') + '/payment/create-link', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(order),
    });
    const data = await res.json();
    if (data.checkoutUrl) window.location.href = data.checkoutUrl;
  }
  if (!order) return <div>Chưa có đơn hàng</div>;
  return (
    <div>
      <h2>Order</h2>
      <ul>{order.items.map((it,i)=> <li key={i}>{it.name} x{it.quantity}</li>)}</ul>
      <p>Tổng: {order.total}</p>
      <button onClick={pay}>Thanh toán ngay</button>
    </div>
  );
}
