export default function Page({ searchParams }) {
  return (
    <div>
      <h1>Payment status</h1>
      <pre>{JSON.stringify(searchParams, null, 2)}</pre>
    </div>
  );
}
